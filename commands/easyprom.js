import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import Member from '../models/Member.js';
import Nomination from '../models/Nomination.js';
import { applyPromotion } from '../utils/promotionManager.js';
import { loadConfig } from '../utils/configLoader.js';

const config = loadConfig();

function getPromoRole() {
  return config.committees?.list?.promotion?.roles?.member?.[0]
    || config.committees?.list?.promotion?.roles?.deputy?.[0]
    || config.committees?.list?.promotion?.roles?.manager?.[0]
    || '1421916208357310554';
}

function getPresRole() {
  return config.committees?.list?.family_presidency?.roles?.member?.[0]
    || '1451612325927714927';
}

export default {
  data: new SlashCommandBuilder()
    .setName('ترقية-استثنائية')
    .setDescription('ترقية عضو استثنائياً')
    .addUserOption(o => o.setName('العضو').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('الرتبة').setDescription('رقم الرتبة').setRequired(true))
    .addStringOption(o => o.setName('السبب').setDescription('السبب').setRequired(true)),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('العضو');
    const newRankNum = interaction.options.getInteger('الرتبة');
    const reason = interaction.options.getString('السبب');

    const memberData = await Member.findOne({ discordId: targetUser.id });
    if (!memberData) return interaction.reply({ content: '❌ غير مسجل.', flags: MessageFlags.Ephemeral });

    const gm = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!gm) return interaction.reply({ content: '❌ غير موجود بالسيرفر.', flags: MessageFlags.Ephemeral });

    const ranks = config.promotion?.ranks;
    if (!ranks?.[newRankNum - 1]) return interaction.reply({ content: '❌ رتبة غير صحيحة.', flags: MessageFlags.Ephemeral });

    const activeNom = await Nomination.findOne({ targetId: targetUser.id, ended: { $ne: true } });
    if (activeNom) {
      return interaction.reply({ content: `❌ العضو لديه ترشيح نشط. يمكنك الترقية بعد انتهاء التصويت أو رفضه.`, flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const promoRoleId = getPromoRole();
    const presRoleId = getPresRole();
    const nextRankData = ranks[newRankNum - 1];

    const announcementText = `**▬▬▬▬▬▬▬▬ ﷽ ▬▬▬▬▬▬▬▬**

**وقرار اخر صادر من  <@&${presRoleId}>   و اللجنة المسؤولة <@&${promoRoleId}> عن شؤون الاعضاء داخل العائلة بعد المراجعه و النظر لـ التفاعل الاستثنائي  وبعد المراجعه و التدقيق و تعديل بعض البيانات قررنا التالي المذكور أدناه : **

### تقرر اعطاء ترقية استثنائية لكل من : 

- ${targetUser}
  

> **بترقية العضاء المذكورين  أعلاه لـ  :  ${nextRankData.roleId ? `<@&${nextRankData.roleId}>` : nextRankData.name}     **

> **وتسليمه المسؤوليات التالية : ${nextRankData.responsibilities || 'لا توجد مسؤوليات إضافية'}  **

## نتمنى لكم الاستمرار في تميزكم فى عملكم.

-# يمكنك تقديم تظلم من خلال <#1388879337171980420> 

-** إمــضــاء و تــوقــيــع ✍️ **:   <@&${promoRoleId}>  
-** إمــضــاء و تــوقــيــع محرر القرار ✍️ **:   ${interaction.user}
▬▬▬▬▬▬▬▬  𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 ▬▬▬▬▬▬▬▬`;

    await applyPromotion({
      memberData, guildMember: gm,
      newRank: nextRankData, newRankIndex: newRankNum - 1,
      promoterId: interaction.user.id, promoterName: interaction.user.tag,
      guild: interaction.guild,
      options: { reason, type: 'ترقية استثنائية', silent: false, announcementText }
    });

    await interaction.editReply(`✅ تمت ترقية ${targetUser.tag} بنجاح.`);
  }
};
