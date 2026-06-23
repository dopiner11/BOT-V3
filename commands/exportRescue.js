import { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUTPUT_PATH = join(__dirname, '..', 'rescueSender', 'targets.json');

export default {
  data: new SlashCommandBuilder()
    .setName('تصدير_المنقذين')
    .setDescription('جلب IDs اللي انفك باندهم وحفظهم في ملف للـ rescueSender')
    .addIntegerOption(option =>
      option.setName('المدة')
        .setDescription('خلل كم دقيقة ندور (افتراضي 60)')
        .setRequired(false)
        .setMinValue(5)
        .setMaxValue(1440)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const minutes = interaction.options.getInteger('المدة') || 60;
      const since = Date.now() - minutes * 60 * 1000;

      await interaction.editReply('🔄 جاري البحث في سجل التدقيق...');

      const unbannedIds = [];
      const seen = new Set();
      let lastId = null;
      let hasMore = true;

      while (hasMore) {
        const fetched = await interaction.guild.fetchAuditLogs({
          type: 23,
          limit: 100,
          before: lastId || undefined,
        });

        const entries = [...fetched.entries.values()];
        if (entries.length === 0) break;

        let timeExpired = false;
        for (const entry of entries) {
          lastId = entry.id;
          if (entry.createdTimestamp < since) { timeExpired = true; break; }
          if (entry.action !== 23) continue;
          if (seen.has(entry.targetId)) continue;
          seen.add(entry.targetId);
          unbannedIds.push(entry.targetId);
        }

        if (timeExpired || entries.length < 100) hasMore = false;
      }

      if (unbannedIds.length === 0) {
        return interaction.editReply('❌ لم يتم العثور على أي أعضاء انفك باندهم خلال الـ ' + minutes + ' دقيقة الماضية.');
      }

      // حفظ في ملف
      const data = JSON.stringify(unbannedIds, null, 2);
      mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
      writeFileSync(OUTPUT_PATH, data, 'utf8');

      // إرسال الملف
      const file = new AttachmentBuilder(Buffer.from(data, 'utf8'), { name: 'targets.json' });

      const embed = new EmbedBuilder()
        .setTitle('✅ تم التصدير بنجاح')
        .setColor(0x2ECC71)
        .addFields(
          { name: 'عدد الأعضاء', value: `${unbannedIds.length}`, inline: true },
          { name: 'الفترة', value: `آخر ${minutes} دقيقة`, inline: true },
          { name: 'الملف', value: '`rescueSender/targets.json`', inline: false },
        )
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        files: [file],
      });
    } catch (error) {
      console.error('❌ Error in export rescue command:', error);
      await interaction.editReply('❌ حدث خطأ: ' + error.message).catch(() => {});
    }
  }
};
