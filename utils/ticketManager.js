import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  EmbedBuilder
} from 'discord.js';
import { success as embedSuccess, error as embedError, warning as embedWarning, info as embedInfo, neutral as embedNeutral, gold as embedGold, custom as embedCustom } from '../utils/embedStyles.js';
import { dmUser } from '../utils/notificationSystem.js';
import Ticket from '../models/Ticket.js';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Transcript from '../models/Transcript.js';

// يجب تعريف __filename و __dirname أولاً
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// تحميل الإعدادات بشكل ديناميكي
function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '../config.json'), 'utf8'));
  } catch (error) {
    console.error('❌ خطأ في قراءة ملف الإعدادات في ticketManager:', error);
    return {
      categories: { tickets: 'tickets_category_id', memberRooms: 'member_rooms_category_id' },
      permissions: { blacklist: ['admin_role_id'] },
      roles: { basic: '', temporary: '', jobRoles: {} }
    };
  }
}

// إنشاء مجلد transcripts إذا لم يكن موجوداً
const transcriptsDir = join(__dirname, '../transcripts');
if (!existsSync(transcriptsDir)) {
  try {
    mkdirSync(transcriptsDir, { recursive: true });
    console.log(`📁 [تم إنشاء مجلد transcripts]: ${transcriptsDir}`);
  } catch (mkdirError) {
    console.error('❌ فشل إنشاء مجلد transcripts:', mkdirError);
  }
}
export async function createTicket(guild, userId, type = 'application') {
  try {
    console.log(`🎫 [إنشاء تذكرة] للمستخدم: ${userId}, النوع: ${type}`);

    const config = loadConfig();
    // الحصول على رقم التذكرة التالي
    const lastTickets = await Ticket.find({}, { ticketNumber: -1 }, 1);
    const lastTicket = lastTickets[0] || null;
    const ticketNumber = lastTicket ? lastTicket.ticketNumber + 1 : 100;

    console.log(`🔢 [رقم التذكرة]: ${ticketNumber}`);

    // Check Ticket Blacklist only (لا علاقة للبلاك ليست العائلية بالتذاكر)
    const { default: TicketBlacklist } = await import('../models/TicketBlacklist.js');
    const ticketBL = await TicketBlacklist.findOne({ userId, expiresAt: { $gt: new Date() } });
    if (ticketBL) {
      throw new Error(`❌ أنت ممنوع من فتح التذاكر!\n**السبب:** ${ticketBL.reason}\n**ينتهي في:** <t:${Math.floor(ticketBL.expiresAt.getTime() / 1000)}:R>`);
    }

    // Check for active tickets (Skip check for Black Market Sales/Apps)
    if (type !== 'black_market_sale' && type !== 'black_market_application') {
      const activeTicket = await Ticket.findOne({
        userId,
        status: { $in: ['open', 'claimed'] }
      });

      if (activeTicket) {
        throw new Error('❌ لديك تذكرة مفتوحة بالفعل! يجب إغلاقها قبل فتح تذكرة جديدة.');
      }
    }

    // جلب نوع التذكرة من الإعدادات الجديدة
    const ticketConfig = config.ticketSystem?.types?.find(t => t.value === type);
    const ticketLabel = ticketConfig ? ticketConfig.label : getTicketTypeArabic(type);

    // التحقق من وجود فئة التذاكر (الأولوية: الفئة الخاصة بالنوع > الفئة العامة للنظام > الفئة العامة في categories)
    const categoryId = ticketConfig?.categoryId || config.ticketSystem?.categoryId || config.general?.categories?.tickets?.id;
    // نجرب من الكاش أولاً، وإذا ما طلعت نجلبه من الـ API (الكاش ما يغطي الروحات اللي تزيد عن 2500)
    let category = guild.channels.cache.get(categoryId);
    if (!category && categoryId) {
      category = await guild.channels.fetch(categoryId).catch(() => null);
    }
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error(`❌ فئة التذاكر غير موجودة أو غير صحيحة (ID: ${categoryId})`);
    }

    // جلب معلومات العضو
    let member;
    try {
      member = await guild.members.fetch(userId);
    } catch (error) {
      console.error(`⚠️ فشل جلب العضو ${userId}:`, error);
    }

    // إعداد صلاحيات القناة
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
    ];

    // إضافة صلاحيات للمستخدم صاحب التذكرة
    const userToAdd = member ? member.id : userId;
    permissionOverwrites.push({
      id: userToAdd,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ],
    });

    // إضافة صلاحيات الرتب المسؤولة (من النظام الجديد)
    let mentionRoles = '';
    if (ticketConfig && ticketConfig.supportRoleIds) {
      ticketConfig.supportRoleIds.forEach(roleId => {
        const role = guild.roles.cache.get(roleId);
        if (role) {
          mentionRoles += `<@&${role.id}> `;
          permissionOverwrites.push({
            id: role.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks
            ]
          });
        }
      });
    }

    // صلاحيات جميع اللجان (النظام الجديد)
    const allCommitteeRoles = getAllCommitteeRoles(config);
    for (const roleId of allCommitteeRoles) {
      const role = guild.roles.cache.get(roleId);
      if (role) {
        permissionOverwrites.push({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles
          ],
        });
      }
    }

    // حفظ التذكرة في قاعدة البيانات أولاً (لقفل الرقم ومنع التكرار)
    const ticket = new Ticket({
      ticketNumber,
      channelId: 'pending',
      userId,
      type,
      status: 'open',
      createdAt: new Date()
    });
    await ticket.save();
    console.log(`💾 [تم حفظ التذكرة في قاعدة البيانات]: ${ticketNumber}`);

    // إنشاء قناة التذكرة (بعد حفظ الرقم لضمان عدم التكرار)
    const channel = await guild.channels.create({
      name: `🎫-تذكرة-${ticketNumber}`,
      type: ChannelType.GuildText,
      parent: category,
      permissionOverwrites: permissionOverwrites,
      topic: `🎫 تذكرة ${ticketNumber} - ${ticketLabel}`
    });

    console.log(`📁 [تم إنشاء القناة]: ${channel.id}`);

    // تحديث التذكرة ب ID القناة
    ticket.channelId = channel.id;
    await ticket.save();

    // إنشاء واجهة التذكرة
    const embed = embedSuccess(`🎫 تذكرة رقم #${ticketNumber}`, `مرحباً بك <@${userId}> في تذكرتك!\n\nستقوم الإدارة بالرد عليك في أقرب وقت.`, [
      { name: '📋 نوع التذكرة', value: ticketLabel, inline: true },
      { name: '👤 صاحب التذكرة', value: `<@${userId}>`, inline: true },
      { name: '🆔 أيدي المستخدم', value: userId, inline: true },
      { name: '📅 تاريخ الإنشاء', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: false },
      { name: '🔰 الحالة', value: '🟢 **مفتوحة**', inline: true }
    ])
      .setThumbnail(member ? member.user.displayAvatarURL() : 'https://cdn.discordapp.com/emojis/1003451893573369896.webp')
      .setFooter({ text: `تذكرة #${ticketNumber} • ${guild.name}` });

    // أزرار التحكم في التذكرة
    // تمرير النوع لتحديد التصنيف
    const buttons = createTicketButtons(ticketNumber, type);

    // إرسال رسالة الترحيب
    const welcomeMessage = await channel.send({
      content: `<@${userId}> ${mentionRoles} 👋`,
      embeds: [embed],
      components: buttons
    });

    // تثبيت رسالة الترحيب
    try {
      await welcomeMessage.pin();
    } catch (error) {
      console.log('⚠️ لم أستطع تثبيت الرسالة:', error.message);
    }

    console.log(`✅ [تم إنشاء التذكرة بنجاح]: #${ticketNumber}`);
    return {
      channel,
      ticketNumber,
      ticketId: ticket._id,
      channelId: channel.id
    };
  } catch (error) {
    console.error('❌ خطأ في إنشاء التذكرة:', error);
    throw error;
  }
}

/**
 * 🔧 الحصول على النوع العربي للتذكرة
 * @param {string} type - نوع التذكرة بالإنجليزية
 * @returns {string} - نوع التذكرة بالعربية
 */
function getTicketTypeArabic(type) {
  const types = {
    'application': '📝 طلب انضمام',
    'warning_removal': '⚠️ إزالة تحذيرات',
    'support': '🛠 دعم فني',
    'report': '📋 تقرير',
    'general': '💬 عام'
  };
  return types[type] || '💬 عام';
}

/**
 * 🎛️ إنشاء أزرار التحكم في التذكرة
 * @param {number} ticketNumber - رقم التذكرة
 * @returns {ActionRowBuilder[]} - مصفوفة أزرار
 */
export function createTicketButtons(ticketNumber, type = 'application') {
  const row1 = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`claim_ticket_${ticketNumber}`)
        .setLabel('✋ استلام التذكرة')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✋'),
      new ButtonBuilder()
        .setCustomId(`close_ticket_${ticketNumber}`)
        .setLabel('🔒 إغلاق التذكرة')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒')
    );

  const row2 = new ActionRowBuilder();

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`add_user_ticket_${ticketNumber}`)
      .setLabel('👥 إضافة شخص')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👥')
  );

  // Only show Finish Application for application tickets
  if (type === 'application') {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`finish_application_${ticketNumber}`)
        .setLabel('✅ إنهاء القبول')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
    );
  }

  if (type === 'black_market_application') {
    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(`end_bm_app_${ticketNumber}`)
        .setLabel('✅ إنهاء التقديم')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅')
    );
  }

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`notify_ticket_${ticketNumber}`)
      .setLabel('إشعار صاحب التذكرة')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔔')
  );

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(`rename_ticket_app_${ticketNumber}`)
      .setLabel('تغيير اسم التيكت')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🏷️')
  );

  return [row1, row2];
}


/**
 * ✋ استلام التذكرة
 * @param {ButtonInteraction} interaction - تفاعل الزر
 * @param {string} ticketNumber - رقم التذكرة
 */
// دالة مساعدة لجلب كل رتب اللجان (member + deputy + manager) للسماح لجميع اللجان باستخدام أزرار التذاكر
function getAllCommitteeRoles(config) {
  const roles = [];
  const committees = config.committees?.list || {};
  for (const key of Object.keys(committees)) {
    const committee = committees[key];
    const roleTypes = ['member', 'deputy', 'manager'];
    for (const type of roleTypes) {
      const roleList = committee.roles?.[type];
      if (Array.isArray(roleList)) {
        for (const id of roleList) {
          if (id) roles.push(id);
        }
      }
    }
  }
  return roles;
}

export async function claimTicket(interaction, ticketNumber) {
  const config = loadConfig();

  try {
    console.log(`✋ [استلام تذكرة]: ${ticketNumber}`);

    // التحقق من أن القناة ما زالت موجودة ويمكن للوشاح الوصول إليها
    const channelExists = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
    if (!channelExists) {
      console.warn(`⚠️ [استلام تذكرة]: القناة غير موجودة أو تم حذفها: ${interaction.channelId}`);
      const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
      if (ticket) {
        ticket.status = 'closed';
        ticket.closeReason = 'القناة تم حذفها يدوياً';
        await ticket.save();
      }
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ **خطأ:** هذه القناة لم تعد موجودة أو تم حذفها!', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }

    // تأجيل الرد أولاً لمنع أخطاء التفاعل
    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate().catch(() => {});
    }

    // البحث عن التذكرة
    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) {
      return await interaction.followUp({
        content: '❌ **لم يتم العثور على التذكرة!**',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }

    // --- Permission Check Start ---
    const ticketTypeConfig = config.ticketSystem?.types?.find(t => t.value === ticket.type);
    const responsibleRoles = ticketTypeConfig?.supportRoleIds || [];

    // جميع رتب اللجان
    const committeeRoles = getAllCommitteeRoles(config);
    const globalRoles = [...committeeRoles];

    const hasPermission = interaction.member.roles.cache.some(role =>
      responsibleRoles.includes(role.id) || globalRoles.includes(role.id)
    ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPermission) {
      return await interaction.followUp({
        content: '❌ **ليس لديك صلاحية لاستلام هذه التذكرة!**\nهذه التذكرة مخصصة لرتب معينة.',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    // --- Permission Check End ---

    // Prevent owner from claiming
    if (ticket.userId === interaction.user.id) {
      return await interaction.followUp({
        content: '❌ **لا يمكنك استلام تذكرتك الخاصة!**',
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }

    // التحقق من حالة التذكرة
    if (ticket.status === 'claimed') {
      return await interaction.followUp({
        content: `❌ **هذه التذكرة مستلمة بالفعل من قبل <@${ticket.claimedBy}>!**`,
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }

    // تحديث حالة التذكرة
    ticket.claimedBy = interaction.user.id;
    ticket.status = 'claimed';
    ticket.claimedAt = new Date();
    await ticket.save();

    // تحديث الإيمبد
    if (interaction.message && interaction.message.embeds && interaction.message.embeds[0]) {
      const originalEmbed = interaction.message.embeds[0];

      // إنشاء إيمبد جديد من الأصل
      const fields = [];
      const originalFields = originalEmbed.fields || [];
      for (const field of originalFields) {
        if (field.name === '🔰 الحالة') {
          fields.push({
            name: '🔰 الحالة',
            value: '🟡 **تم الاستلام**',
            inline: true
          });
        } else if (field.name === '👤 صاحب التذكرة' || field.name === '🆔 أيدي المستخدم' || field.name === '📝 سبب الإغلاق' || field.name === '👮‍♂️ أغلقت بواسطة' || field.name === '⏰ وقت الإغلاق') {
          fields.push(field);
        } else if (field.name === '📋 نوع التذكرة') {
          fields.push(field);
        }
      }
      fields.push(
        { name: '👮‍♂️ مستلم التذكرة', value: `<@${interaction.user.id}>`, inline: true },
        { name: '⏰ وقت الاستلام', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
      );
      const updatedEmbed = embedWarning(originalEmbed.title || `🎫 تذكرة رقم #${ticketNumber}`, originalEmbed.description || '', fields)
        .setFooter({
          text: `تذكرة #${ticketNumber} • استلمها: ${interaction.user.username}`
        });

      // تحديث الأزرار لتعكس حالة الاستلام
      const row1 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`unclaim_ticket_${ticketNumber}`)
            .setLabel('🚫 إلغاء الاستلام')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🚫'),
          new ButtonBuilder()
            .setCustomId(`close_ticket_${ticketNumber}`)
            .setLabel('🔒 إغلاق التذكرة')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
        );

      // Keep row2 as is from helper or reconstruct
      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`add_user_ticket_${ticketNumber}`)
            .setLabel('👥 إضافة شخص')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥'),
          new ButtonBuilder()
            .setCustomId(`notify_ticket_${ticketNumber}`)
            .setLabel('إشعار صاحب التذكرة')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔔'),
          new ButtonBuilder()
            .setCustomId(`rename_ticket_app_${ticketNumber}`)
            .setLabel('تغيير اسم التيكت')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🏷️')
        );

      if (ticket.type === 'application') {
        row2.addComponents(
          new ButtonBuilder()
            .setCustomId(`finish_application_${ticketNumber}`)
            .setLabel('✅ إنهاء القبول')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅')
        );
      }

      await interaction.message.edit({
        embeds: [updatedEmbed],
        components: [row1, row2]
      }).catch(editError => {
        console.warn(`⚠️ [استلام تذكرة]: فشل تعديل رسالة التذكرة (ربما تم حذف الرسالة):`, editError.message);
      });
    }

    // إرسال إشعار للمستخدم
    const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) {
      const notificationEmbed = embedWarning('📢 تم استلام تذكرتك', `تم استلام تذكرتك من قبل <@${interaction.user.id}>\nسيساعدك في حل مشكلتك قريباً.`);

      await ticketChannel.send({
        content: `<@${ticket.userId}>`,
        embeds: [notificationEmbed]
      }).catch(sendError => {
        console.warn(`⚠️ [استلام تذكرة]: فشل إرسال رسالة الاستلام إلى روم التذكرة:`, sendError.message);
      });
    }

    await interaction.followUp({
      content: `✅ **تم استلام التذكرة #${ticketNumber} بنجاح!**`,
      flags: MessageFlags.Ephemeral
    }).catch(() => {});

    console.log(`✅ [تم استلام التذكرة]: #${ticketNumber} بواسطة ${interaction.user.tag}`);

  } catch (error) {
    console.error('❌ خطأ في استلام التذكرة:', error);
    try {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ خطأ!', flags: MessageFlags.Ephemeral });
      else await interaction.followUp({ content: '❌ خطأ!', flags: MessageFlags.Ephemeral });
    } catch (e) { }
  }
}

export async function unclaimTicket(interaction, ticketNumber) {
  const config = loadConfig();

  try {
    console.log(`🚫 [إلغاء استلام تذكرة]: ${ticketNumber}`);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.deferUpdate();
    }

    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) {
      return await interaction.followUp({ content: '❌ **لم يتم العثور على التذكرة!**', flags: MessageFlags.Ephemeral });
    }

    // --- Permission Check ---
    const ticketTypeConfig = config.ticketSystem?.types?.find(t => t.value === ticket.type);
    const responsibleRoles = ticketTypeConfig?.supportRoleIds || [];
    const committeeRoles = getAllCommitteeRoles(config);
    const globalRoles = [...committeeRoles];

    // Allow if responsible role OR admin OR if the user is the one who claimed it (even if they lost role?)
    // Usually only staff can unclaim.
    const hasPermission = interaction.member.roles.cache.some(role =>
      responsibleRoles.includes(role.id) || globalRoles.includes(role.id)
    ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator) || ticket.claimedBy === interaction.user.id;

    if (!hasPermission) {
      return await interaction.followUp({ content: '❌ **لا يمكنك إلغاء استلام هذه التذكرة!**', flags: MessageFlags.Ephemeral });
    }

    if (ticket.status !== 'claimed') {
      return await interaction.followUp({ content: '❌ **هذه التذكرة غير مستلمة!**', flags: MessageFlags.Ephemeral });
    }

    ticket.claimedBy = null;
    ticket.status = 'open';
    ticket.claimedAt = null;
    await ticket.save();

    // Update Embed (Revert to Green)
    if (interaction.message && interaction.message.embeds[0]) {
      const originalEmbed = interaction.message.embeds[0];
      const fields = [];
      const originalFields = originalEmbed.fields || [];
      for (const field of originalFields) {
        if (['📋 نوع التذكرة', '👤 صاحب التذكرة', '🆔 أيدي المستخدم', '📅 تاريخ الإنشاء'].includes(field.name)) {
          fields.push(field);
        }
      }
      fields.push({ name: '🔰 الحالة', value: '🟢 **مفتوحة**', inline: true });
      const updatedEmbed = embedSuccess(originalEmbed.title, originalEmbed.description, fields)
        .setFooter({ text: `تذكرة #${ticketNumber} • ${interaction.guild.name}` });

      const buttons = createTicketButtons(ticketNumber, ticket.type);
      await interaction.message.edit({ embeds: [updatedEmbed], components: buttons });
    }

    const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) {
      await ticketChannel.send({
        content: `<@${ticket.userId}>`,
        embeds: [embedWarning('🔄 تم إلغاء استلام التذكرة', `تم الغاء الاستلام من قبل <@${interaction.user.id}>`)]
      });
    }

    await interaction.followUp({ content: `✅ **تم إلغاء استلام التذكرة #${ticketNumber} بنجاح!**`, flags: MessageFlags.Ephemeral });

  } catch (error) {
    console.error('Unclaim error', error);
  }
}

export async function closeTicket(interaction, ticketNumber) {
  const config = loadConfig();
  try {
    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة', flags: MessageFlags.Ephemeral });

    // Permission Check
    const ticketTypeConfig = config.ticketSystem?.types?.find(t => t.value === ticket.type);
    const responsibleRoles = ticketTypeConfig?.supportRoleIds || [];
    const committeeRoles = getAllCommitteeRoles(config);
    const globalRoles = [...committeeRoles];

    const hasPermission = interaction.member.roles.cache.some(role =>
      responsibleRoles.includes(role.id) || globalRoles.includes(role.id)
    ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPermission) return interaction.reply({ content: '❌ ليس لديك صلاحية لإغلاق هذه التذكرة!', flags: MessageFlags.Ephemeral });

    if (ticket.status === 'closed') return interaction.reply({ content: '❌ مغلقة بالفعل', flags: MessageFlags.Ephemeral });

    const modal = new ModalBuilder()
      .setCustomId(`close_reason_modal_${ticketNumber}`)
      .setTitle('سبب إغلاق التذكرة');

    const reasonInput = new TextInputBuilder()
      .setCustomId('close_reason')
      .setLabel('السبب')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(5);

    modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
    await interaction.showModal(modal).catch(() => {});

  } catch (error) {
    console.error(error);
  }
}

export async function addUserToTicket(interaction, ticketNumber) {
  const config = loadConfig();
  try {
    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة', flags: MessageFlags.Ephemeral });

    // Permission Check
    const ticketTypeConfig = config.ticketSystem?.types?.find(t => t.value === ticket.type);
    const responsibleRoles = ticketTypeConfig?.supportRoleIds || [];
    const committeeRoles = getAllCommitteeRoles(config);
    const globalRoles = [...committeeRoles];

    const hasPermission = interaction.member.roles.cache.some(role =>
      responsibleRoles.includes(role.id) || globalRoles.includes(role.id)
    ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPermission) {
      return interaction.reply({ content: '❌ ليس لديك صلاحية لاضافة شخص لهذه التذكرة!', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId(`add_user_modal_${ticketNumber}`)
      .setTitle('إضافة شخص للتذكرة');

    const userIdInput = new TextInputBuilder()
      .setCustomId('user_id')
      .setLabel('🆔 أيدي المستخدم')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(userIdInput));
    await interaction.showModal(modal).catch(() => {});

  } catch (error) {
    console.error(error);
  }
}


export async function processAddUser(interaction, ticketNumber, userId) {
  try {
    console.log(`👤 [معالجة إضافة مستخدم]: ${ticketNumber}, المستخدم: ${userId}`);

    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) {
      return interaction.editReply({
        content: '❌ **لم يتم العثور على التذكرة!**'
      });
    }

    // تنظيف أيدي المستخدم
    const cleanUserId = userId.trim().replace(/[<@!>]/g, '');

    // التحقق من صحة الأيدي
    if (!cleanUserId.match(/^\d{17,20}$/)) {
      return interaction.editReply({
        content: '❌ **أيدي المستخدم غير صالح!**\nيرجى إدخال أيدي صحيح (17-20 رقم)'
      });
    }

    // جلب العضو
    const member = await interaction.guild.members.fetch(cleanUserId).catch(() => null);
    if (!member) {
      return interaction.editReply({
        content: '❌ **لم يتم العثور على المستخدم في السيرفر!**'
      });
    }

    // إضافة الصلاحيات للقناة
    const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
    if (!ticketChannel) {
      return interaction.editReply({
        content: '❌ **لم يتم العثور على قناة التذكرة!**'
      });
    }

    await ticketChannel.permissionOverwrites.create(member, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    });

    // إرسال إشعار في القناة
    const notificationEmbed = embedInfo('👥 تمت إضافة شخص جديد', `تمت إضافة <@${cleanUserId}> إلى التذكرة بواسطة <@${interaction.user.id}>`);

    await ticketChannel.send({
      content: `<@${ticket.userId}> <@${cleanUserId}>`,
      embeds: [notificationEmbed]
    });

    await interaction.editReply({
      content: `✅ **تمت إضافة <@${cleanUserId}> إلى التذكرة بنجاح!**`
    });

    console.log(`✅ [تمت إضافة المستخدم]: ${cleanUserId} إلى التذكرة #${ticketNumber}`);

  } catch (error) {
    console.error('❌ خطأ في إضافة المستخدم:', error);
    await interaction.editReply({
      content: '❌ حدث خطأ أثناء إضافة المستخدم!'
    });
  }
}



export async function processRenameTicketApp(interaction, ticketNumber, newName) {
  try {
    const ticketChannel = interaction.channel;
    if (!ticketChannel) return interaction.editReply('❌ تعذر العثور على القناة.');

    // clean name
    const cleanName = newName.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-_]/g, '').trim();

    const oldName = ticketChannel.name.replace('🎫-', '');
    await ticketChannel.setName(`🎫-${cleanName}`);

    const embed = embedSuccess('📝 تغيير اسم التذكرة', `✅ **تم تغيير اسم التذكرة بنجاح**\n\n**👤 بواسطة:** <@${interaction.user.id}>\n**🏷️ الاسم القديم:** ${oldName}\n**🏷️ الاسم الجديد:** ${cleanName}`);

    await ticketChannel.send({ embeds: [embed] });
    await interaction.editReply({ content: '✅ تم تغيير الاسم بنجاح' });

  } catch (error) {
    console.error('Error renaming ticket:', error);
    await interaction.editReply('❌ حدث خطأ أثناء تغيير الاسم (قد يكون بسبب تجاوز الحدود أو الصلاحيات).');
  }
}

export async function handleRenameTicketApp(interaction, ticketNumber) {
  const config = loadConfig();
  try {
    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة', flags: MessageFlags.Ephemeral });

    // Permission Check
    const ticketTypeConfig = config.ticketSystem?.types?.find(t => t.value === ticket.type);
    const responsibleRoles = ticketTypeConfig?.supportRoleIds || [];
    const committeeRoles = getAllCommitteeRoles(config);
    const globalRoles = [...committeeRoles];

    const hasPermission = interaction.member.roles.cache.some(role =>
      responsibleRoles.includes(role.id) || globalRoles.includes(role.id)
    ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPermission) {
      return interaction.reply({ content: '❌ ليس لديك صلاحية لتغيير اسم التذكرة!', flags: MessageFlags.Ephemeral });
    }

    const modal = new ModalBuilder()
      .setCustomId(`rename_ticket_modal_app_${ticketNumber}`)
      .setTitle('تغيير اسم التذكرة');

    const nameInput = new TextInputBuilder()
      .setCustomId('new_name')
      .setLabel('الاسم الجديد')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(50);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
    await interaction.showModal(modal).catch(() => {});

  } catch (error) {
    console.error(error);
  }
}




// ticketManager.js - دالة finishApplication معدلة
export async function finishApplication(interaction, ticketNumber) {
  const config = loadConfig();
  const committeeRoles = getAllCommitteeRoles(config);
  const hasPermission = interaction.member.roles.cache.some(role =>
    committeeRoles.includes(role.id)
  ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

  if (!hasPermission) {
    return interaction.reply({ content: '❌ ليس لديك صلاحية لانهاء القبول!', flags: MessageFlags.Ephemeral });
  }
  try {
    console.log(`✅ [إنهاء قبول عضو]: ${ticketNumber}`);

    const modal = new ModalBuilder()
      .setCustomId(`finish_application_modal_${ticketNumber}`)
      .setTitle('إنهاء قبول العضو - تعبئة البيانات');

    // 1. Discord ID
    const discordIdInput = new TextInputBuilder()
      .setCustomId('discord_id')
      .setLabel('🆔 أيدي الديسكورد')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('123456789012345678')
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20);

    // 2. اسم الشخصية (بدون X.IRAQ)
    const characterNameInput = new TextInputBuilder()
      .setCustomId('character_name')
      .setLabel('🎮 اسم الشخصية (بدون X.IRAQ)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('أحمد')
      .setRequired(true)
      .setMaxLength(20);

    // 3. ID داخل اللعبة
    const gameIdInput = new TextInputBuilder()
      .setCustomId('game_id')
      .setLabel('🎮 ID داخل اللعبة')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('12345')
      .setRequired(true);

    // 4. الفل (Level)
    const levelInput = new TextInputBuilder()
      .setCustomId('level')
      .setLabel('📈 الفل (Level)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('40')
      .setRequired(true);

    // 5. رقم الرتبة
    const jobNumberInput = new TextInputBuilder()
      .setCustomId('job_number')
      .setLabel('💼 رقم الرتبة (1-6)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('رقم بين 1 و 6')
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(1);

    modal.addComponents(
      new ActionRowBuilder().addComponents(discordIdInput),
      new ActionRowBuilder().addComponents(characterNameInput),
      new ActionRowBuilder().addComponents(gameIdInput),
      new ActionRowBuilder().addComponents(levelInput),
      new ActionRowBuilder().addComponents(jobNumberInput)
    );

    await interaction.showModal(modal).catch(() => {});

  } catch (error) {
    console.error('❌ خطأ في إنشاء نموذج إنهاء القبول:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ حدث خطأ أثناء إنشاء نموذج إنهاء القبول',
        flags: MessageFlags.Ephemeral
      });
    }
  }
}

// ticketManager.js - دالة processFinishApplication معدلة بالكامل
export async function processFinishApplication(interaction, ticketNumber, discordId, characterName, gameId, level, jobNumber) {
  try {
    console.log(`🎓 [معالجة إنهاء القبول]: تذكرة ${ticketNumber}`);

    // تنظيف المدخلات
    const cleanDiscordId = discordId.trim().replace(/[<@!>]/g, '');
    const cleanCharacterName = characterName.trim();
    const cleanGameId = gameId.trim();
    const cleanLevel = level.trim();
    const cleanJobNumber = jobNumber.trim();

    // التحقق من صحة رقم الرتبة
    const jobNum = parseInt(cleanJobNumber);
    if (isNaN(jobNum) || jobNum < 1 || jobNum > 6) {
      return interaction.editReply({
        content: '❌ **رقم الرتبة يجب أن يكون بين 1 و 6!**'
      });
    }

    // التحقق من صحة الفل
    const levelNum = parseInt(cleanLevel);
    if (isNaN(levelNum) || levelNum < 1) {
      return interaction.editReply({
        content: '❌ **الفل يجب أن يكون رقم صحيح موجب!**'
      });
    }

    // التحقق من صحة ID اللعبة
    if (!/^\d+$/.test(cleanGameId)) {
      return interaction.editReply({
        content: '❌ **ID اللعبة يجب أن يحتوي على أرقام فقط!**'
      });
    }

    // جلب نموذج Member
    let Member;
    try {
      const memberModule = await import('../models/Member.js');
      Member = memberModule.default || memberModule;
    } catch (error) {
      console.error('❌ خطأ في استيراد نموذج Member:', error);
      return interaction.editReply({
        content: '❌ **خطأ في نظام قاعدة البيانات!**'
      });
    }

    // جلب العضو من السيرفر
    let member;
    try {
      member = await interaction.guild.members.fetch(cleanDiscordId);
      console.log(`👤 [تم العثور على العضو]: ${member.user.tag}`);
    } catch (error) {
      console.error(`❌ فشل جلب العضو ${cleanDiscordId}:`, error);
      return interaction.editReply({
        content: `❌ **لم يتم العثور على المستخدم <@${cleanDiscordId}> في السيرفر!**`
      });
    }

    // التحقق من البلاك ليست
    try {
      const { default: Blacklist } = await import('../models/Blacklist.js');
      const blacklisted = await Blacklist.findOne({ userId: cleanDiscordId, isActive: true });
      if (blacklisted) {
        return interaction.editReply({
          content: `❌ **هذا العضو في البلاك ليست ولا يمكن توظيفه!**\n**السبب:** ${blacklisted.reason}`
        });
      }
    } catch (error) {
      console.error('❌ فشل التحقق من البلاك ليست:', error);
    }

    // ========== 1. تغيير النيك نيم ==========
    try {
      const nickname = `IQ • ${cleanCharacterName} X.IRAQ 〢${cleanGameId}`;
      await member.setNickname(nickname);
      console.log(`✅ [تم تغيير النيك نيم]: ${nickname}`);
    } catch (error) {
      console.log(`Could not rename ${member.user.tag}: ${error.message}`);
    }

    // ========== 2. تحديد تصنيف الفل ==========
    let levelCategory;
    if (levelNum < 25) {
      levelCategory = 'تحت 25';
    } else if (levelNum < 40) {
      levelCategory = 'تحت 40';
    } else {
      levelCategory = 'اكثر من 40';
    }

    // ========== 3. إنشاء روم العضو ==========
    let roomChannel;
    try {
      roomChannel = await createMemberRoom(interaction.guild, cleanDiscordId, cleanCharacterName, cleanGameId, levelCategory);
    } catch (error) {
      console.error('❌ فشل إنشاء روم العضو:', error);
      return interaction.editReply({
        content: '❌ **فشل في إنشاء روم العضو!**'
      });
    }

    // ========== 4. إضافة الأدوار ==========
    const config = loadConfig();
    const rolesAdded = [];
    try {
      // الرتبة الأساسية
      if (config.roles?.basic?.id) {
        const basicRole = interaction.guild.roles.cache.get(config.roles.basic.id);
        if (basicRole) {
          await member.roles.add(basicRole);
          rolesAdded.push('🏆 الرتبة الأساسية');
          console.log(`✅ [تمت إضافة الرتبة الأساسية]: لـ ${member.user.tag}`);
        }
      }

      // رتبة الوظيفة
      const jobRoleId = config.roles?.jobRoles?.[jobNum.toString()]?.id;
      if (jobRoleId) {
        const jobRole = interaction.guild.roles.cache.get(jobRoleId);
        if (jobRole) {
          await member.roles.add(jobRole);
          rolesAdded.push(`💼 رتبة الوظيفة (${jobNum})`);
          console.log(`✅ [تمت إضافة رتبة الوظيفة]: ${jobNum} لـ ${member.user.tag}`);
        }
      }
    } catch (error) {
      console.error('❌ خطأ في إضافة الأدوار:', error);
      // نستمر حتى لو فشلت إضافة الأدوار
    }

    // ========== 5. حفظ العضو في قاعدة البيانات ==========
    try {
      // التحقق من وجود العضو مسبقاً
      let existingMember = await Member.findOne({ discordId: cleanDiscordId });

      if (existingMember) {
        // تحديث العضو الموجود (إعادة توظيف)
        existingMember.level = levelNum;
        existingMember.gameId = cleanGameId;
        existingMember.gameName = cleanCharacterName;
        existingMember.jobNumber = jobNum;
        existingMember.roomChannelId = roomChannel.id;
        existingMember.currentRank = 'مبتدئ'; // تصفير الرتبة عند إعادة التوظيف
        existingMember.points = 0; // تصفير النقاط لكي يبدأ من الصفر
        existingMember.isActive = true;
        existingMember.joinDate = new Date(); // تعيين تاريخ انضمام جديد
        existingMember.joinMethod = 'تقديم قبول';
        existingMember.hiredBy = interaction.user.id;
        existingMember.updatedAt = new Date();
        existingMember.lastActivity = new Date();
        existingMember.lastUserActivity = new Date();
        existingMember.firedAt = undefined;
        existingMember.firedBy = undefined;

        await existingMember.save();
        console.log(`💾 [تم تحديث وإعادة توظيف العضو]: ${cleanDiscordId}`);
      } else {
        // إنشاء عضو جديد
        const newMember = new Member({
          discordId: cleanDiscordId,
          level: levelNum,
          gameId: cleanGameId,
          gameName: cleanCharacterName,
          jobNumber: jobNum,
          roomChannelId: roomChannel.id,
          currentRank: 'مبتدئ',
          points: 0,
          joinDate: new Date(),
          joinMethod: 'تقديم قبول',
          hiredBy: interaction.user.id,
          isActive: true,
          lastActivity: new Date(),
          lastUserActivity: new Date()
        });

        await newMember.save();
        console.log(`💾 [تم إنشاء عضو جديد]: ${cleanDiscordId}`);
      }
    } catch (error) {
      console.error('❌ خطأ في حفظ العضو:', error);
      await interaction.editReply({
        content: `❌ **حدث خطأ في حفظ بيانات العضو في النظام!**\n\nالرجاء المحاولة مرة أخرى أو التواصل مع المبرمج.\n\n**الخطأ:** ${error.message}`
      });
      return; // ← نوقف العملية هنا، الروم والرتب راح تظل موجودة
    }

    // ========== 5.5. إنشاء فترة سماح تلقائية للعضو الجديد ==========
    try {
      const { createGracePeriod } = await import('./interactionMonitor.js');
      await createGracePeriod(cleanDiscordId, 'new_member', interaction.guild, interaction.client, null).catch(err => {
        console.error('❌ فشل إنشاء فترة سماح للعضو الجديد:', err);
      });
    } catch (err) {
      console.error('❌ خطأ في استيراد createGracePeriod:', err);
    }

    // ========== 6. إرسال رسالة ترحيب في الروم مع الأزرار ==========
    try {
      const { sendWelcomeGuide } = await import('../utils/welcomeGuide.js');
      const targetUser = await interaction.client.users.fetch(cleanDiscordId).catch(() => null);
      if (targetUser && roomChannel) {
        await sendWelcomeGuide(interaction.client, interaction.guild, targetUser, cleanCharacterName, cleanGameId, cleanLevel, jobNum, roomChannel);
      }
    } catch (error) {
      console.error('❌ خطأ في إرسال رسالة الترحيب:', error);
    }

    // ========== 7. تحديث قناة التذكرة ==========
    const ticketChannel = interaction.guild.channels.cache.get(interaction.channelId);
    if (ticketChannel) {
      const finishEmbed = embedSuccess('✅ تم إنهاء القبول بنجاح', `تم انهاء قبول العضو <@${cleanDiscordId}> بنجاح`, [
        { name: '🎮 اسم الشخصية', value: cleanCharacterName, inline: true },
        { name: '🆔 أيدي اللعبة', value: cleanGameId, inline: true },
        { name: '📈 الفل', value: cleanLevel, inline: true },
        { name: '💼 رقم الرتبة', value: `#${jobNum}`, inline: true },
        { name: '🏠 الروم الخاص', value: `<#${roomChannel.id}>`, inline: true },
        { name: '🎖️ الأدوار المضافة', value: rolesAdded.join('\n') || 'تمت إضافة الأدوار المطلوبة', inline: false }
      ]);

      await ticketChannel.send({ embeds: [finishEmbed] });
    }

    // ========== 8. الرد للمسؤول ==========
    await interaction.editReply({
      content: `✅ **تم إنهاء القبول بنجاح!**\n\n` +
        `**👤 العضو:** <@${cleanDiscordId}>\n` +
        `**🏠 الروم:** <#${roomChannel.id}>\n` +
        `**💼 رقم الرتبة:** ${jobNum}\n` +
        `**🎖️ الأدوار المضافة:** ${rolesAdded.join(', ') || 'تمت إضافة الأدوار المطلوبة'}`
    });

    // ========== 9. تسجيل في اللوغ ==========
    try {
      const { logHiring } = await import('./logSystem.js');
      await logHiring(interaction.guild, {
        target: { id: cleanDiscordId },
        mod: interaction.user,
        role: `#${jobNum}`,
        details: `الاسم: ${cleanCharacterName} | أيدي: ${cleanGameId} | روم: ${roomChannel.id}`
      });
    } catch (logError) {
      console.error('❌ خطأ في تسجيل اللوغ:', logError);
    }
  } catch (error) {
    console.error('❌ خطأ في إنهاء القبول:', error);
    await interaction.editReply({
      content: `❌ حدث خطأ غير متوقع أثناء إنهاء القبول!\n\n${error.message}`
    });
  }
}






// ticketManager.js - دالة createMemberRoom معدلة
async function createMemberRoom(guild, discordId, characterName, gameId, levelCategory) {
  try {
    const config = loadConfig();
    const categoryId = config.general?.categories?.memberRooms?.id;
    let category = guild.channels.cache.get(categoryId);
    if (!category && categoryId) {
      category = await guild.channels.fetch(categoryId).catch(() => null);
    }
    if (!category) {
      throw new Error('❌ فئة غرف الأعضاء غير موجودة في الإعدادات');
    }

    // إنشاء اسم الروم الجديد
    const roomName = `🏠〢${characterName}-xiraq・${gameId}・${levelCategory}`;

    const channel = await guild.channels.create({
      name: roomName,
      type: ChannelType.GuildText,
      parent: category,
      topic: `🏠 غرفة ${characterName} | أيدي الديسكورد: ${discordId} | أيدي اللعبة: ${gameId} | الفل: ${levelCategory}`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: discordId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks
          ],
        },
        // صلاحيات اللجان
        ...getAllCommitteeRoles(config).map(roleId => ({
          id: roleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.ManageChannels
          ],
        })),
      ],
    });

    console.log(`🏠 [تم إنشاء روم العضو]: ${channel.name}`);
    return channel;

  } catch (error) {
    console.error('❌ خطأ في إنشاء روم العضو:', error);
    throw error;
  }
}






export async function handleTicketButton(interaction, action, ticketNumber) {
  try {
    console.log(`🎛️ [معالجة زر التذكرة]: ${action} - ${ticketNumber}`);

    // فحص إذا كان الرقم يحتوي على جزء من الـ customId
    if (ticketNumber && typeof ticketNumber === 'string' && ticketNumber.includes('_')) {
      const parts = ticketNumber.split('_');
      if (parts.length >= 2) {
        // استخراج رقم التذكرة الحقيقي (آخر جزء)
        const actualTicketNumber = parts[parts.length - 1];
        if (!isNaN(actualTicketNumber)) {
          ticketNumber = actualTicketNumber;
        }
      }
    }

    switch (action) {
      case 'claim':
        await claimTicket(interaction, ticketNumber);
        break;
      case 'unclaim':
        await unclaimTicket(interaction, ticketNumber);
        break;
      case 'close':
        await closeTicket(interaction, ticketNumber);
        break;
      case 'add_user':
        await addUserToTicket(interaction, ticketNumber);
        break;
      case 'finish_application':
        // التأكد من أن ticketNumber هو رقم حقيقي
        const cleanTicketNumber = ticketNumber.toString().replace('finish_application_', '');
        await finishApplication(interaction, cleanTicketNumber);
        break;
      case 'end_bm_app':
        const cleanBmNumber = ticketNumber.toString().replace('end_bm_app_', '');
        await handleEndBMApp(interaction, cleanBmNumber);
        break;
      default:
        // تحقق إذا كان الـ action يحتوي على finish_application_XXX
        if (action && action.startsWith('finish_application_')) {
          const cleanNumber = action.replace('finish_application_', '');
          await finishApplication(interaction, cleanNumber);
          break;
        }

        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ هذا الزر غير معروف!',
            flags: MessageFlags.Ephemeral
          });
        }
    }
  } catch (error) {
    console.error('❌ خطأ في معالجة زر التذكرة:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء معالجة الزر!',
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      console.error('❌ فشل إرسال رسالة الخطأ:', replyError);
    }
  }
}

export async function saveTranscriptWithLinks(ticketChannel, ticket, reason, closedBy) {
  try {
    console.log(`📝 [بدء حفظ transcript مع الروابط]: تذكرة #${ticket.ticketNumber}`);

    let allMessages = [];
    let lastMessageId = null;
    let messageCount = 0;

    // جلب جميع الرسائل
    try {
      while (true) {
        const options = { limit: 100 };
        if (lastMessageId) {
          options.before = lastMessageId;
        }

        const messages = await ticketChannel.messages.fetch(options);

        if (messages.size === 0) break;

        allMessages = allMessages.concat(Array.from(messages.values()));
        lastMessageId = messages.last().id;
        messageCount += messages.size;

        if (messages.size < 100) break;
      }

      console.log(`📊 [تم جلب الرسائل]: ${messageCount} رسالة`);
    } catch (fetchError) {
      console.error('❌ خطأ في جلب الرسائل:', fetchError);
      return null;
    }

    // فرز الرسائل من الأقدم إلى الأحدث
    allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // تحويل الرسائل إلى تنسيق قابل للحفظ
    const formattedMessages = allMessages.map(msg => ({
      messageId: msg.id,
      authorId: msg.author.id,
      authorTag: msg.author.tag,
      authorAvatar: msg.author.displayAvatarURL({ format: 'png', size: 128 }),
      content: msg.content || '',
      embeds: msg.embeds.map(embed => ({
        title: embed.title || '',
        description: embed.description || '',
        color: embed.color || null,
        fields: embed.fields || [],
        timestamp: embed.timestamp || null,
        footer: embed.footer || null,
        image: embed.image || null,
        thumbnail: embed.thumbnail || null,
        url: embed.url || null
      })),
      attachments: msg.attachments.map(att => ({
        name: att.name,
        url: att.url,
        contentType: att.contentType,
        size: att.size
      })),
      timestamp: msg.createdAt,
      isSystem: msg.author.bot || msg.system || false
    }));

    // حساب مدة التذكرة
    const createdAt = new Date(ticket.createdAt);
    const closedAt = new Date();
    const durationMs = closedAt.getTime() - createdAt.getTime();
    const duration = formatDuration(durationMs);

    // إنشاء ID فريد للـ transcript
    const transcriptId = `TR-${Date.now()}-${ticket.ticketNumber}`;

    // حفظ transcript في قاعدة البيانات
    const transcript = new Transcript({
      ticketNumber: ticket.ticketNumber,
      channelId: ticket.channelId,
      userId: ticket.userId,
      claimedBy: ticket.claimedBy || null,
      closedBy: closedBy,
      type: ticket.type,
      status: 'closed',
      messages: formattedMessages,
      closedAt: closedAt,
      closeReason: reason,
      transcriptId: transcriptId,
      messageCount: messageCount,
      duration: duration,
      hasLinks: false // سيتم تحديثها لاحقاً
    });

    await transcript.save();
    console.log(`💾 [تم حفظ transcript في قاعدة البيانات]: ${transcriptId}`);

    return {
      transcriptId,
      messageCount,
      duration,
      createdAt,
      closedAt,
      closedBy: closedBy,
      messages: formattedMessages
    };

  } catch (error) {
    console.error('❌ خطأ في حفظ transcript:', error);
    return null;
  }
}


function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} يوم و ${hours % 24} ساعة`;
  } else if (hours > 0) {
    return `${hours} ساعة و ${minutes % 60} دقيقة`;
  } else if (minutes > 0) {
    return `${minutes} دقيقة و ${seconds % 60} ثانية`;
  } else {
    return `${seconds} ثانية`;
  }
}


/**
 * 📊 تنسيق حجم الملف
 * @param {number} bytes - الحجم بالبايت
 * @returns {string} - الحجم المنسق
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 بايت';

  const k = 1024;
  const sizes = ['بايت', 'كيلوبايت', 'ميجابايت', 'جيجابايت'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


export function createHTMLTranscript(messages, ticket, transcriptData, closerUsername = 'غير معروف') {
  const html = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نسخة تذكرة #${ticket.ticketNumber}</title>
    <style>
        :root {
            --primary-color: #5865F2;
            --secondary-color: #57F287;
            --danger-color: #ED4245;
            --warning-color: #FEE75C;
            --dark-color: #2C2F33;
            --light-color: #f8f9fa;
        }
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px;
            min-height: 100vh;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, var(--primary-color) 0%, #764ba2 100%);
            color: white;
            padding: 40px 30px;
            text-align: center;
            position: relative;
        }
        
        .header::before {
            content: "🎫";
            font-size: 80px;
            position: absolute;
            top: 20px;
            right: 30px;
            opacity: 0.3;
        }
        
        .header h1 {
            font-size: 3em;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .header .subtitle {
            font-size: 1.3em;
            opacity: 0.9;
            margin-bottom: 20px;
        }
        
        .ticket-number {
            background: rgba(255,255,255,0.2);
            padding: 10px 20px;
            border-radius: 50px;
            display: inline-block;
            font-size: 1.5em;
            font-weight: bold;
            backdrop-filter: blur(10px);
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
            background: var(--light-color);
            border-bottom: 2px solid #e9ecef;
        }
        
        .info-card {
            background: white;
            padding: 25px;
            border-radius: 15px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.1);
            border-right: 5px solid var(--primary-color);
            transition: transform 0.3s ease;
        }
        
        .info-card:hover {
            transform: translateY(-5px);
        }
        
        .info-card h3 {
            color: var(--primary-color);
            margin-bottom: 15px;
            font-size: 1.1em;
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 8px;
        }
        
        .info-card p {
            color: #333;
            font-size: 1.2em;
            font-weight: bold;
            line-height: 1.6;
        }
        
        .chat-container {
            padding: 30px;
            max-height: 800px;
            overflow-y: auto;
            background: #f8f9fa;
        }
        
        .message {
            margin-bottom: 25px;
            padding: 25px;
            border-radius: 15px;
            background: white;
            position: relative;
            transition: all 0.3s ease;
            border: 2px solid transparent;
        }
        
        .message:hover {
            transform: translateY(-3px);
            box-shadow: 0 15px 30px rgba(0,0,0,0.15);
            border-color: var(--primary-color);
        }
        
        .message-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 2px solid #e9ecef;
        }
        
        .avatar {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            margin-left: 20px;
            border: 3px solid var(--primary-color);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .author-info {
            flex-grow: 1;
        }
        
        .author-name {
            font-weight: bold;
            color: #333;
            font-size: 1.3em;
            margin-bottom: 5px;
        }
        
        .author-id {
            color: #666;
            font-size: 0.9em;
            background: #f1f3f5;
            padding: 3px 10px;
            border-radius: 10px;
            display: inline-block;
        }
        
        .timestamp {
            color: #888;
            font-size: 0.9em;
            direction: ltr;
            background: #f8f9fa;
            padding: 5px 15px;
            border-radius: 20px;
        }
        
        .message-content {
            color: #333;
            font-size: 1.2em;
            line-height: 1.8;
            margin-bottom: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 10px;
            border-right: 4px solid var(--primary-color);
        }
        
        .attachments {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 2px dashed #e9ecef;
        }
        
        .attachment {
            display: inline-block;
            background: white;
            padding: 12px 20px;
            border-radius: 10px;
            margin: 5px;
            border: 2px solid var(--primary-color);
            color: var(--primary-color);
            text-decoration: none;
            font-weight: bold;
            transition: all 0.3s ease;
            box-shadow: 0 3px 10px rgba(0,0,0,0.1);
        }
        
        .attachment:hover {
            background: var(--primary-color);
            color: white;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .embed {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 20px;
            margin: 15px 0;
            border-left: 4px solid var(--secondary-color);
        }
        
        .embed-title {
            color: var(--primary-color);
            font-weight: bold;
            margin-bottom: 10px;
            font-size: 1.1em;
        }
        
        .embed-description {
            color: #555;
            line-height: 1.6;
        }
        
        .system-message {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            text-align: center;
            font-weight: bold;
            border: none;
        }
        
        .system-message .message-content {
            background: rgba(255,255,255,0.2);
            color: white;
            border: none;
        }
        
        .footer {
            background: #2C2F33;
            color: white;
            text-align: center;
            padding: 30px;
            border-top: 5px solid var(--primary-color);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin: 30px 0;
            padding: 30px;
            background: rgba(255,255,255,0.1);
            border-radius: 15px;
        }
        
        .stat {
            text-align: center;
            padding: 20px;
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
        }
        
        .stat-number {
            font-size: 2.5em;
            font-weight: bold;
            color: var(--secondary-color);
            margin-bottom: 10px;
        }
        
        .stat-label {
            font-size: 1em;
            opacity: 0.9;
        }
        
        .download-btn {
            display: inline-block;
            background: var(--primary-color);
            color: white;
            padding: 15px 30px;
            border-radius: 10px;
            text-decoration: none;
            font-weight: bold;
            margin: 20px;
            transition: all 0.3s ease;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .download-btn:hover {
            background: #4752C4;
            transform: translateY(-3px);
            box-shadow: 0 8px 20px rgba(0,0,0,0.3);
        }
        
        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 12px;
        }
        
        ::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 10px;
        }
        
        ::-webkit-scrollbar-thumb {
            background: var(--primary-color);
            border-radius: 10px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
            background: #4752C4;
        }
        
        @media (max-width: 768px) {
            .info-grid {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2em;
            }
            
            .message {
                padding: 15px;
            }
            
            .avatar {
                width: 50px;
                height: 50px;
                margin-left: 10px;
            }
            
            .stats {
                grid-template-columns: 1fr;
            }
        }
    </style>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body>
    <div class="container">
        <div class="header">
            <h1><i class="fas fa-ticket-alt"></i> نسخة تذكرة #${ticket.ticketNumber}</h1>
            <div class="subtitle">${getTicketTypeArabic(ticket.type)}</div>
            <div class="ticket-number">#${ticket.ticketNumber}</div>
        </div>
        
        <div class="info-grid">
            <div class="info-card">
                <h3><i class="fas fa-user"></i> صاحب التذكرة</h3>
                <p>${ticket.userId}</p>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-calendar-plus"></i> تاريخ الإنشاء</h3>
                <p>${new Date(ticket.createdAt).toLocaleString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}</p>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-calendar-times"></i> تاريخ الإغلاق</h3>
                <p>${new Date(transcriptData.closedAt).toLocaleString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}</p>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-clock"></i> مدة التذكرة</h3>
                <p>${transcriptData.duration}</p>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-comments"></i> عدد الرسائل</h3>
                <p>${transcriptData.messageCount} رسالة</p>
            </div>
            
            <div class="info-card">
                <h3><i class="fas fa-user-shield"></i> أغلقت بواسطة</h3>
                <p>${closerUsername}</p>
            </div>
        </div>
        
        <div class="chat-container">
            ${messages && messages.length > 0 ? messages.map((msg, index) => `
            <div class="message ${msg.isSystem ? 'system-message' : ''}">
                <div class="message-header">
                    <img src="${msg.authorAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" 
                         alt="${msg.authorTag}" 
                         class="avatar"
                         onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                    <div class="author-info">
                        <div class="author-name">${msg.authorTag}</div>
                        <div class="author-id">${msg.authorId}</div>
                    </div>
                    <div class="timestamp">${new Date(msg.timestamp).toLocaleString('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })}</div>
                </div>
                
                ${msg.content ? `
                <div class="message-content">
                    ${msg.content.replace(/\n/g, '<br>')
        .replace(/<@!?(\d+)>/g, '<span class="mention">@مستخدم</span>')
        .replace(/<#(\d+)>/g, '<span class="channel">#قناة</span>')
        .replace(/<@&(\d+)>/g, '<span class="role">@دور</span>')}
                </div>
                ` : ''}
                
                ${msg.embeds && msg.embeds.length > 0 ? `
                <div class="embeds">
                    ${msg.embeds.map(embed => `
                    <div class="embed">
                        ${embed.title ? `<div class="embed-title">${embed.title}</div>` : ''}
                        ${embed.description ? `<div class="embed-description">${embed.description}</div>` : ''}
                        ${embed.fields && embed.fields.length > 0 ? `
                        <div class="embed-fields">
                            ${embed.fields.map(field => `
                            <div class="embed-field">
                                <strong>${field.name}</strong>: ${field.value}
                            </div>
                            `).join('')}
                        </div>
                        ` : ''}
                    </div>
                    `).join('')}
                </div>
                ` : ''}
                
                ${msg.attachments && msg.attachments.length > 0 ? `
                <div class="attachments">
                    ${msg.attachments.map(att => `
                    <a href="${att.url}" target="_blank" class="attachment">
                        <i class="fas fa-paperclip"></i> ${att.name} (${formatFileSize(att.size)})
                    </a>
                    `).join('')}
                </div>
                ` : ''}
            </div>
            `).join('') : '<div class="message system-message"><div class="message-content">لا توجد رسائل في هذه التذكرة</div></div>'}
        </div>
        
        <div class="footer">
            <div class="stats">
                <div class="stat">
                    <div class="stat-number">#${ticket.ticketNumber}</div>
                    <div class="stat-label">رقم التذكرة</div>
                </div>
                
                <div class="stat">
                    <div class="stat-number">${transcriptData.messageCount}</div>
                    <div class="stat-label">عدد الرسائل</div>
                </div>
                
                <div class="stat">
                    <div class="stat-number">${transcriptData.duration.split(' ')[0]}</div>
                    <div class="stat-label">${transcriptData.duration.split(' ')[1] || 'مدة'}</div>
                </div>
                
                <div class="stat">
                    <div class="stat-number">${transcriptData.transcriptId.substring(0, 8)}</div>
                    <div class="stat-label">معرّف النسخة</div>
                </div>
            </div>
            
            <div style="margin: 30px 0;">
                <h3 style="margin-bottom: 20px; color: var(--secondary-color);">
                    <i class="fas fa-info-circle"></i> معلومات الإغلاق
                </h3>
                <div style="background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin-bottom: 20px;">
                    <p><strong>سبب الإغلاق:</strong> ${ticket.closeReason || 'غير محدد'}</p>
                    <p><strong>تاريخ الإنشاء:</strong> ${new Date(ticket.createdAt).toLocaleString('ar-SA')}</p>
                    <p><strong>تاريخ الإغلاق:</strong> ${new Date(transcriptData.closedAt).toLocaleString('ar-SA')}</p>
                </div>
            </div>
            
            <div>
                <p style="opacity: 0.8; margin-bottom: 20px;">
                    <i class="fas fa-history"></i> تم إنشاء هذه النسخة في: ${new Date().toLocaleString('ar-SA')}
                </p>
                <p style="font-size: 0.9em; opacity: 0.6;">
                    <i class="fas fa-shield-alt"></i> هذه نسخة رسمية من نظام تذاكر الديسكورد
                </p>
            </div>
        </div>
    </div>
    
    <script>
        // إضافة تفاعلية للصفحة
        document.addEventListener('DOMContentLoaded', function() {
            // تسليط الضوء على الرسائل عند المرور عليها
            const messages = document.querySelectorAll('.message');
            messages.forEach(msg => {
                msg.addEventListener('mouseenter', function() {
                    this.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
                });
                msg.addEventListener('mouseleave', function() {
                    this.style.boxShadow = '';
                });
            });
            
            // زر للعودة للأعلى
            const scrollBtn = document.createElement('button');
            scrollBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
            scrollBtn.style.cssText = '
                position: fixed;
                bottom: 20px;
                left: 20px;
                background: var(--primary-color);
                color: white;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                border: none;
                cursor: pointer;
                font-size: 20px;
                box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                display: none;
                z-index: 1000;
            ';
            document.body.appendChild(scrollBtn);
            
            scrollBtn.addEventListener('click', function() {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
            
            window.addEventListener('scroll', function() {
                scrollBtn.style.display = window.scrollY > 300 ? 'block' : 'none';
            });
        });
    </script>
</body>
</html>
  `;

  return Buffer.from(html, 'utf-8');
}



export async function uploadTranscriptFile(fileBuffer, fileName, ticket) {
  try {
    // حفظ الملف محلياً في مجلد transcripts
    const transcriptsDir = join(__dirname, '../transcripts');

    // إنشاء المجلد إذا لم يكن موجوداً
    if (!existsSync(transcriptsDir)) {
      mkdirSync(transcriptsDir, { recursive: true });
      console.log(`📁 [تم إنشاء مجلد transcripts]: ${transcriptsDir}`);
    }

    // حفظ الملف محلياً
    const localPath = join(transcriptsDir, fileName);
    const fs = await import('fs/promises');
    await fs.writeFile(localPath, fileBuffer);

    console.log(`💾 [تم حفظ الملف محلياً]: ${localPath}`);

    // إرجاع null لأننا لا نريد روابط
    return null;

  } catch (error) {
    console.error('❌ خطأ في حفظ الملف:', error);
    return null;
  }
}

/**
 * 🔗 إنشاء إيمبد بالروابط المباشرة
 * @param {Object} ticket - بيانات التذكرة
 * @param {Object} transcriptData - بيانات الـ transcript
 * @param {Array} fileUrls - مصفوفة روابط الملفات
 * @returns {EmbedBuilder} - إيمبد الروابط
 */
export function createTranscriptLinksEmbed(ticket, transcriptData, fileUrls = []) {
  const fields = [];

  if (fileUrls.length > 0) {
    fileUrls.forEach((file) => {
      const fileType = file.name.includes('info') ? '📋 معلومات التذكرة' :
        file.name.includes('transcript') ? '💬 محادثة التذكرة' :
          file.name.includes('html') ? '🌐 نسخة HTML' : '📄 ملف';

      fields.push({
        name: fileType,
        value: file.url ? `[${file.name}](${file.url})` : `📎 ${file.name} (مرفق بالرسالة)`,
        inline: false
      });
    });
  }

  fields.push(
    { name: '🎫 رقم التذكرة', value: `#${ticket.ticketNumber}`, inline: true },
    { name: '📅 التاريخ', value: `<t:${Math.floor(Date.now() / 1000)}:D>`, inline: true },
    { name: '🆔 المعرف', value: `\`${transcriptData.transcriptId}\``, inline: false }
  );

  const embed = embedCustom('#5865F2', `🔗 روابط Transcript التذكرة #${ticket.ticketNumber}`, 'يمكنك الوصول إلى نسخة التذكرة عبر الروابط التالية:', fields);

  return embed;
}/**
 * 📄 إنشاء ملف نصي للـ transcript (محسّن)
 * @param {Array} messages - الرسائل
 * @param {Object} ticket - بيانات التذكرة
 * @param {Object} transcriptData - بيانات الـ transcript
 * @param {string} closerUsername - اسم المستخدم الذي أغلق التذكرة
 * @returns {Buffer} - محتوى الملف
 */
export function createTranscriptFile(messages, ticket, transcriptData, closerUsername = 'غير معروف') {
  let content = '='.repeat(80) + '\n';
  content += `🎫 نسخة نصية للتذكرة #${ticket.ticketNumber}\n`;
  content += '='.repeat(80) + '\n\n';

  // معلومات التذكرة
  content += '📋 معلومات التذكرة:\n';
  content += `- رقم التذكرة: #${ticket.ticketNumber}\n`;
  content += `- النوع: ${getTicketTypeArabic(ticket.type)}\n`;
  content += `- صاحب التذكرة: ${ticket.userId}\n`;
  content += `- تاريخ الإنشاء: ${new Date(ticket.createdAt).toLocaleString('ar-SA')}\n`;
  content += `- تاريخ الإغلاق: ${new Date(transcriptData.closedAt).toLocaleString('ar-SA')}\n`;
  content += `- مدة التذكرة: ${transcriptData.duration}\n`;
  content += `- عدد الرسائل: ${transcriptData.messageCount}\n`;
  content += `- أغلقت بواسطة: ${closerUsername}\n`;
  content += `- سبب الإغلاق: ${ticket.closeReason || 'غير محدد'}\n\n`;

  content += '='.repeat(80) + '\n';
  content += '💬 محادثة التذكرة:\n';
  content += '='.repeat(80) + '\n\n';

  // الرسائل
  if (messages && messages.length > 0) {
    messages.forEach((msg, index) => {
      const date = new Date(msg.timestamp);
      const timeStr = date.toLocaleString('ar-SA');

      content += `[${timeStr}] ${msg.authorTag} (${msg.authorId}):\n`;

      if (msg.content) {
        // تنظيف المحتوى وتنسيقه
        let cleanContent = msg.content
          .replace(/<@!?(\d+)>/g, '[مستخدم:$1]')
          .replace(/<#(\d+)>/g, '[قناة:$1]')
          .replace(/<@&(\d+)>/g, '[دور:$1]')
          .replace(/\*\*(.*?)\*\*/g, '$1')
          .replace(/\*(.*?)\*/g, '$1')
          .replace(/__(.*?)__/g, '$1');

        content += `📝 ${cleanContent}\n`;
      }

      if (msg.embeds && msg.embeds.length > 0) {
        msg.embeds.forEach((embed, embedIndex) => {
          if (embed.title) content += `📊 إيمبد ${embedIndex + 1}: ${embed.title}\n`;
          if (embed.description) content += `   ${embed.description}\n`;
        });
      }

      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(att => {
          content += `📎 مرفق: ${att.name} (${formatFileSize(att.size)})\n`;
        });
      }

      content += '-'.repeat(40) + '\n';
    });
  } else {
    content += '⚠️ لا توجد رسائل في هذه التذكرة\n';
  }

  content += '\n' + '='.repeat(80) + '\n';
  content += `🔚 نهاية محادثة التذكرة #${ticket.ticketNumber}\n`;
  content += `📅 تم إنشاء هذه النسخة في: ${new Date().toLocaleString('ar-SA')}\n`;
  content += '='.repeat(80);

  return Buffer.from(content, 'utf-8');
}


export function createTicketInfoFile(ticket, transcriptData, closerUsername = 'غير معروف') {
  let content = '='.repeat(80) + '\n';
  content += `🎫 معلومات التذكرة #${ticket.ticketNumber}\n`;
  content += '='.repeat(80) + '\n\n';

  // معلومات التذكرة الأساسية
  content += '📊 المعلومات الأساسية:\n';
  content += `- رقم التذكرة: #${ticket.ticketNumber}\n`;
  content += `- النوع: ${getTicketTypeArabic(ticket.type)}\n`;
  content += `- صاحب التذكرة: ${ticket.userId}\n`;
  content += `- أيدي المستخدم: ${ticket.userId}\n`;
  content += `- مستلم التذكرة: ${ticket.claimedBy ? `${ticket.claimedBy} (${getUsernameFromId(ticket.claimedBy)})` : 'لم يتم الاستلام'}\n`;
  content += `- الحالة: ${ticket.status}\n\n`;

  // تواريخ التذكرة
  content += '📅 الجدول الزمني:\n';
  content += `- تاريخ الإنشاء: ${new Date(ticket.createdAt).toLocaleString('ar-SA')}\n`;
  content += `- وقت الإنشاء: ${new Date(ticket.createdAt).toLocaleTimeString('ar-SA')}\n`;
  content += `- تاريخ الاستلام: ${ticket.claimedAt ? new Date(ticket.claimedAt).toLocaleString('ar-SA') : 'لم يتم الاستلام'}\n`;
  content += `- تاريخ الإغلاق: ${new Date(transcriptData.closedAt).toLocaleString('ar-SA')}\n`;
  content += `- وقت الإغلاق: ${new Date(transcriptData.closedAt).toLocaleTimeString('ar-SA')}\n`;
  content += `- مدة التذكرة: ${transcriptData.duration}\n\n`;

  // معلومات الإغلاق
  content += '🔒 معلومات الإغلاق:\n';
  content += `- أغلقت بواسطة: ${closerUsername}\n`;
  content += `- أيدي المغلق: ${ticket.closedBy}\n`;
  content += `- سبب الإغلاق: ${ticket.closeReason || 'غير محدد'}\n\n`;

  // إحصائيات
  content += '📈 إحصائيات التذكرة:\n';
  content += `- عدد الرسائل: ${transcriptData.messageCount}\n`;
  content += `- معرّف Transcript: ${transcriptData.transcriptId}\n`;
  content += `- قناة التذكرة: ${ticket.channelId}\n`;
  content += `- تاريخ حفظ Transcript: ${new Date().toLocaleString('ar-SA')}\n\n`;

  content += '='.repeat(80) + '\n';
  content += '📄 ملخص التذكرة:\n';
  content += '='.repeat(80) + '\n\n';

  // ملخص حسب نوع التذكرة
  if (ticket.type === 'application') {
    content += '📝 نوع التذكرة: طلب انضمام\n';
    content += '📌 تم إنشاء هذه التذكرة لمراجعة طلب انضمام عضو جديد للعائلة.\n';
    content += '📌 العملية: مراجعة طلب → استلام التذكرة → إنهاء القبول → إغلاق التذكرة\n';
  } else if (ticket.type === 'warning_removal') {
    content += '⚠️ نوع التذكرة: إزالة تحذيرات\n';
    content += '📌 تم إنشاء هذه التذكرة لمعالجة طلب إزالة تحذيرات من عضو.\n';
    content += '📌 العملية: طلب إزالة → مراجعة التحذيرات → معالجة الطلب → إغلاق التذكرة\n';
  } else if (ticket.type === 'support') {
    content += '🛠️ نوع التذكرة: دعم فني\n';
    content += '📌 تم إنشاء هذه التذكرة لتقديم الدعم الفني لأحد الأعضاء.\n';
    content += '📌 العملية: طلب دعم → تشخيص المشكلة → تقديم حل → إغلاق التذكرة\n';
  } else {
    content += '💬 نوع التذكرة: عام\n';
    content += '📌 تم إنشاء هذه التذكرة لسبب عام.\n';
  }

  content += '\n' + '='.repeat(80) + '\n';
  content += `✅ تم إنشاء هذه النسخة في: ${new Date().toLocaleString('ar-SA')}\n`;
  content += '='.repeat(80);

  return Buffer.from(content, 'utf-8');
}

function getUsernameFromId(userId) {

  return userId;
}
export async function sendTranscriptToTicketOwner(client, ticket, transcriptData, htmlBuffer) {
  try {
    // جلب المستخدم صاحب التذكرة
    const user = await client.users.fetch(ticket.userId);

    if (!user) {
      console.log(`❌ لم يتم العثور على المستخدم: ${ticket.userId}`);
      return false;
    }

    try {
      // إنشاء إيمبد للرسالة
      const transcriptEmbed = embedInfo(`🎫 نسخة تذكرة #${ticket.ticketNumber}`, `تم إغلاق تذكرتك رقم **#${ticket.ticketNumber}**.\n\n**📝 سبب الإغلاق:** ${ticket.closeReason || 'غير محدد'}\n\nتم إرفاق نسخة HTML كاملة للمحادثة أدناه:`, [
        { name: '👮‍♂️ أغلقت بواسطة', value: `<@${ticket.closedBy}>`, inline: true },
        { name: '📅 تاريخ الإغلاق', value: `<t:${Math.floor(new Date(transcriptData.closedAt).getTime() / 1000)}:F>`, inline: true },
        { name: '⏱️ المدة', value: transcriptData.duration, inline: true },
        { name: '📊 عدد الرسائل', value: transcriptData.messageCount.toString(), inline: true }
      ])
        .setFooter({ text: `Transcript #${ticket.ticketNumber}` });

      const dmData = { embeds: [transcriptEmbed] };
      if (htmlBuffer) dmData.files = [new AttachmentBuilder(htmlBuffer, { name: `ticket-${ticket.ticketNumber}.html` })];
      await user.send(dmData).catch(e => {
        if (e.code === 50007) console.warn(`DM closed for ${user.tag}`);
        else console.error('Failed to send transcript DM:', e.message);
      });

      console.log(`✅ [تم إرسال transcript للمالك]: ${user.tag}`);
      return true;

    } catch (dmError) {
      if (dmError.code === 50278) {
        console.warn(`⚠️ فشل إرسال transcript لـ ${user.tag} (غادر السيرفر أو ما عنده DM مفتوح)`);
      } else if (dmError.code === 50007) {
        console.warn(`⚠️ فشل إرسال transcript لـ ${user.tag} (DM مقفل)`);
      } else {
        console.error(`❌ فشل إرسال DM للمستخدم ${user.tag}:`, dmError.message);
      }

      // محاولة إرسال إشعار في القناة
      try {
        const ticketChannel = client.channels.cache.get(ticket.channelId);
        if (ticketChannel) {
          await ticketChannel.send({
            content: `<@${ticket.userId}>`,
            embeds: [
              embedWarning('⚠️ فشل إرسال الرسالة الخاصة', 'لم أستطع إرسال نسخة التذكرة لك عبر الرسائل الخاصة.\nيرجى التأكد من أنك تسمح باستقبال الرسائل الخاصة من أعضاء السيرفر.')
            ]
          });
        }
      } catch (channelError) {
        console.error('❌ فشل إرسال إشعار في القناة:', channelError);
      }

      return false;
    }

  } catch (error) {
    console.error('❌ خطأ في إرسال transcript للمالك:', error);
    return false;
  }
}
export async function sendTranscriptToChannel(guild, ticket, transcriptData, htmlBuffer) {
  try {
    const config = loadConfig();
    const transcriptsChannelId = config.ticketSystem?.channels?.transcripts?.id || config.general?.channels?.logChannel?.id;
    if (!transcriptsChannelId) {
      console.log('⚠️ قناة transcripts غير محددة في الإعدادات');
      return null;
    }

    const transcriptsChannel = guild.channels.cache.get(transcriptsChannelId);
    if (!transcriptsChannel) {
      console.log(`⚠️ لم يتم العثور على قناة transcripts: ${transcriptsChannelId}`);
      return null;
    }

    // إنشاء إيمبد للـ transcript
    const ratingStatus = ticket.rating ? `${'⭐'.repeat(ticket.rating)} ${ticket.rating}/5` : '⏳ قيد الانتظار';
    const transcriptEmbed = embedInfo(`📄 Transcript التذكرة #${ticket.ticketNumber}`, 'تم إنشاء نسخة HTML للتذكرة', [
      { name: '🎫 رقم التذكرة', value: `#${ticket.ticketNumber}`, inline: true },
      { name: '📋 النوع', value: getTicketTypeArabic(ticket.type), inline: true },
      { name: '👤 صاحب التذكرة', value: `<@${ticket.userId}>`, inline: true },
      { name: '👮‍♂️ أغلقت بواسطة', value: `<@${transcriptData.closedBy}>`, inline: true },
      { name: '📅 تاريخ الإنشاء', value: `<t:${Math.floor(ticket.createdAt.getTime() / 1000)}:F>`, inline: true },
      { name: '🔒 تاريخ الإغلاق', value: `<t:${Math.floor(transcriptData.closedAt.getTime() / 1000)}:F>`, inline: true },
      { name: '⏱️ المدة', value: transcriptData.duration, inline: true },
      { name: '📊 عدد الرسائل', value: transcriptData.messageCount.toString(), inline: true },
      { name: '⭐ التقييم', value: ratingStatus, inline: true },
      { name: '📝 سبب الإغلاق', value: ticket.closeReason || 'غير محدد', inline: false },
      { name: '🆔 معرّف Transcript', value: `\`${transcriptData.transcriptId}\``, inline: false }
    ])
      .setFooter({ text: `Transcript #${ticket.ticketNumber}` });

    // إرسال الملف HTML كمرفق
    const attachments = [];

    if (htmlBuffer) {
      attachments.push(new AttachmentBuilder(htmlBuffer, {
        name: `ticket-${ticket.ticketNumber}.html`
      }));
    }

    const message = await transcriptsChannel.send({
      embeds: [transcriptEmbed],
      files: attachments
    });

    // حفظ ID رسالة التران سكربت في التذكرة لتحديثها لاحقاً عند التقييم
    ticket.transcriptMessageId = message.id;
    ticket.transcriptChannelId = transcriptsChannel.id;
    await ticket.save();

    console.log(`✅ [تم إرسال transcript]: لقناة ${transcriptsChannel.name}`);

    return message;

  } catch (error) {
    console.error('❌ خطأ في إرسال transcript:', error);
    return null;
  }
}



export async function closeTicketWithReason(interaction, ticketNumber, reason) {
  const config = loadConfig();
  try {
    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ التذكرة غير موجودة', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (ticket.status === 'closed') {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ مغلقة بالفعل', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.followUp({ content: '❌ مغلقة بالفعل', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    // Defer update if not already deferred (safe guard)
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => { });
    }

    // 1. Update ticket in DB
    ticket.status = 'closed';
    ticket.closedBy = interaction.user.id;
    ticket.closeReason = reason;
    ticket.closedAt = new Date();
    await ticket.save();

    const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
    if (ticketChannel) {
      // 2. Generate Transcript
      const { createDiscordTranscript } = await import('./discordTranscript.js');

      const transcriptData = await saveTranscriptWithLinks(ticketChannel, ticket, reason, interaction.user.id);

      let htmlBuffer = null;
      if (transcriptData) {
        htmlBuffer = createDiscordTranscript(transcriptData.messages, ticket, transcriptData, interaction.user.tag);

        // 3. Send Transcript to Channel (only if we have transcript data)
        await sendTranscriptToChannel(interaction.guild, ticket, transcriptData, htmlBuffer);

        // 4. Send Transcript to User (only if we have transcript data)
        await sendTranscriptToTicketOwner(interaction.client, ticket, transcriptData, htmlBuffer);
      }

      // 5. Notify in channel with rich embed
      const closerTag = interaction.user.tag;
      const closeEmbed = embedError('🔒 إغلاق التذكرة', `✅ **تم إغلاق التذكرة بنجاح**
        
**👤 أغلقت بواسطة:** <@${interaction.user.id}> (\`${closerTag}\`)
**📝 السبب:** ${reason}

⚙️ **العمليات الجارية:**
⏳ جاري حفظ نسخة من المحادثة...
📨 جاري إرسال النسخة إلى السجلات...
🗑️ سيتم حذف القناة خلال 5 ثوانٍ...`);

      await ticketChannel.send({ embeds: [closeEmbed] });

      // Confirm to the user (since we deferred reply)
      if (interaction.deferred) {
        await interaction.editReply({ content: '✅ جاري إغلاق التذكرة...' }).catch(() => { });
      }

      // إرسال طلب تقييم الخدمة لصاحب التذكرة
      try {
        await sendTicketRatingRequest(interaction.client, ticket, ticketChannel);
      } catch (e) {
        console.error('Failed to send rating request:', e);
      }

      setTimeout(async () => {
        await ticketChannel.delete().catch(() => { });
      }, 5000);
    }

  } catch (error) {
    console.error('Error closing ticket with reason:', error);
  }
}

// =============================================================================
// ==================== ADDITIONAL EXPORTS ====================================
// =============================================================================

export async function handleAddUserModal(interaction, ticketNumber, targetId) {
  await interaction.deferReply();
  const cleanId = targetId.replace(/[<@!>]/g, '');
  const user = await interaction.guild.members.fetch(cleanId).catch(() => null);
  if (!user) return interaction.editReply('❌ المستخدم غير موجود.');

  const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
  if (!ticket) return interaction.editReply('❌ التذكرة غير موجودة.');

  const channel = interaction.guild.channels.cache.get(ticket.channelId);
  if (!channel) return interaction.editReply('❌ القناة غير موجودة.');

  await channel.permissionOverwrites.edit(user.id, {
    ViewChannel: true,
    SendMessages: true
  });

  await interaction.editReply(`✅ تم إضافة <@${user.id}> إلى التذكرة.`);
}

export async function handleRenameTicketModal(interaction, ticketNumber, newName) {
  await interaction.deferReply();
  const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
  if (!ticket) return interaction.editReply('❌ التذكرة غير موجودة.');

  const channel = interaction.guild.channels.cache.get(ticket.channelId);
  if (!channel) return interaction.editReply('❌ القناة غير موجودة.');

  // تنظيف الاسم من الرموز غير المسموحة
  const cleanName = newName.replace(/[^a-zA-Z0-9\u0600-\u06FF\s-_]/g, '').trim();
  // الحفاظ على الإيموجي 🎫- وإضافة الاسم الجديد
  await channel.setName(`🎫-${cleanName}`).catch(e => console.error(e));
  await interaction.editReply(`✅ تم تغيير اسم التذكرة إلى: 🎫-${cleanName}`);
}



export async function processEndBMApp(interaction, ticketNumber, userId, rankIndex) {
  const config = loadConfig();
  await interaction.deferReply();

  const cleanId = userId.replace(/[<@!>]/g, '');
  const member = await interaction.guild.members.fetch(cleanId).catch(() => null);

  if (!member) return interaction.editReply('❌ العضو غير موجود.');

  // Rank Logic
  // ranks index 0 to 4 based on user input 1 to 5
  const index = parseInt(rankIndex) - 1;
  const ranks = config.blackMarket?.ranks || [];

  if (isNaN(index) || index < 0 || index >= ranks.length) {
    return interaction.editReply(`❌ رقم الرتبة غير صحيح. يرجى اختيار رقم بين 1 و ${ranks.length}`);
  }

  const selectedRank = ranks[index];
  const roleId = selectedRank.roleId;

  // رتبة البائع الأساسية (مثل member role)
  const sellerMemberRole = config.blackMarket?.roles?.member || [];

  // الرتبة الأساسية للعضو (basic role)
  const basicRoleId = config.roles?.basic?.id;

  try {
    // Add Basic Role (يحافظ على الرتبة الأساسية)
    if (basicRoleId) await member.roles.add(basicRoleId).catch(e => console.error('Failed to add basic role', e));

    // Add Rank Role
    if (roleId) await member.roles.add(roleId).catch(e => console.error('Failed to add rank role', e));

    // Add Member/Seller Roles
    if (sellerMemberRole.length > 0) {
      for (const rId of sellerMemberRole) {
        await member.roles.add(rId).catch(e => console.error('Failed to add member role', e));
      }
    }

    // Save to DB
    const { default: BlackMarketSeller } = await import('../models/BlackMarketSeller.js');
    let seller = await BlackMarketSeller.findOne({ userId: cleanId });
    if (!seller) {
      seller = new BlackMarketSeller({
        userId: cleanId,
        hiredBy: interaction.user.id,
        method: 'application'
      });
    } else {
      seller.isActive = true;
    }
    await seller.save();

    await interaction.editReply(`✅ **تم تعيين البائع بنجاح!**\n👤 العضو: <@${cleanId}>\n🔰 الرتبة: ${selectedRank.name}\n📜 تم تسجيله في النظام.`);

    // Log ? 

    // Close Ticket Prompt?
    // Usually we just let them close it manually or automate it.
    // For now, just success message.

  } catch (error) {
    console.error(error);
    await interaction.editReply('❌ حدث خطأ أثناء تعيين الرتب.');
  }
}

export async function handleEndBMApp(interaction, ticketNumber) {
  const modal = new ModalBuilder()
    .setCustomId(`finish_bm_app_modal_${ticketNumber}`)
    .setTitle('إنهاء تعيين البلاك ماركت');

  const discordIdInput = new TextInputBuilder()
    .setCustomId('discord_id')
    .setLabel('أيدي الديسكورد')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const rankInput = new TextInputBuilder()
    .setCustomId('rank_index')
    .setLabel('رقم الرتبة (1 - 5)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  modal.addComponents(
    new ActionRowBuilder().addComponents(discordIdInput),
    new ActionRowBuilder().addComponents(rankInput)
  );
  await interaction.showModal(modal).catch(() => {});
}

// =============================================================================
// ==================== إشعار صاحب التذكرة =====================================
// =============================================================================

export async function handleNotifyTicketOwner(interaction, ticketNumber) {
  const config = loadConfig();
  try {
    const ticket = await Ticket.findOne({ ticketNumber: parseInt(ticketNumber) });
    if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة', flags: MessageFlags.Ephemeral });

    if (ticket.status === 'closed') {
      return interaction.reply({ content: '❌ التذكرة مغلقة، لا يمكن إرسال إشعار.', flags: MessageFlags.Ephemeral });
    }

    // Check Permission
    const ticketTypeConfig = config.ticketSystem?.types?.find(t => t.value === ticket.type);
    const responsibleRoles = ticketTypeConfig?.supportRoleIds || [];
    const committeeRoles = getAllCommitteeRoles(config);
    const globalRoles = [...committeeRoles];
    const hasPermission = interaction.member.roles.cache.some(role =>
      responsibleRoles.includes(role.id) || globalRoles.includes(role.id)
    ) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);

    if (!hasPermission) {
      return interaction.reply({ content: '❌ ليس لديك صلاحية لإرسال إشعار لصاحب التذكرة!', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const owner = await interaction.client.users.fetch(ticket.userId).catch(() => null);
    if (!owner) return interaction.editReply('❌ لم يتم العثور على صاحب التذكرة.');

    const ticketChannel = interaction.guild.channels.cache.get(ticket.channelId);
    if (!ticketChannel) return interaction.editReply('❌ قناة التذكرة غير موجودة.');

    const embed = embedSuccess(`🔔 إشعار بتحديث على التذكرة #${ticket.ticketNumber}`, `مرحباً! 👋\n\nتم الرد على تذكرتك رقم **#${ticket.ticketNumber}** من قبل الإدارة.\nيرجى التوجه إلى التذكرة للمتابعة: ${ticketChannel.toString()}`, [
      { name: '📋 نوع التذكرة', value: getTicketTypeArabic(ticket.type), inline: true },
      { name: '👮‍♂️ تم الإشعار بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);

    const dmSent = await dmUser(owner, embed);
    if (!dmSent) {
      await ticketChannel.send({
        content: `<@${ticket.userId}>`,
        embeds: [embedWarning('⚠️ فشل إرسال رسالة خاصة', 'لم نتمكن من إرسال إشعار لك عبر الخاص. يرجى التوجه إلى التذكرة لمتابعة الرد.')]
      });
    }

    // تأكيد الإرسال
    await interaction.editReply('✅ **تم إرسال الإشعار إلى صاحب التذكرة بنجاح!**');

    // تسجيل الإشعار في القناة
    const logEmbed = embedSuccess('🔔 إشعار لصاحب التذكرة', `تم إرسال إشعار إلى <@${ticket.userId}> للرجوع إلى التذكرة.`, [
      { name: '🎫 رقم التذكرة', value: `#${ticket.ticketNumber}`, inline: true },
      { name: '👮‍♂️ أرسل بواسطة', value: `<@${interaction.user.id}>`, inline: true }
    ]);
    await ticketChannel.send({ embeds: [logEmbed] });

  } catch (error) {
    console.error('Error notifying ticket owner:', error);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ حدث خطأ أثناء إرسال الإشعار.', flags: MessageFlags.Ephemeral });
    }
  }
}

// =============================================================================
// ==================== نظام تقييم التذاكر ====================================
// =============================================================================

export async function sendTicketRatingRequest(client, ticket, ticketChannel) {
  const config = loadConfig();
  try {
    const owner = await client.users.fetch(ticket.userId).catch(() => null);
    if (!owner) return;

    const embed = embedGold('⭐ تقييم الخدمة', `مرحباً! 😊\n\nتم إغلاق تذكرتك رقم **#${ticket.ticketNumber}**.\nنرجو منك تقييم جودة الخدمة التي تلقيتها لمساعدتنا في التطوير المستمر.`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`rate_ticket_${ticket._id}`)
        .setLabel('⭐ تقييم الخدمة')
        .setStyle(ButtonStyle.Primary)
    );

    await owner.send({ embeds: [embed], components: [row] }).catch(e => {
      if (e.code === 50278 || e.code === 50007) console.warn(`⚠️ فشل إرسال تقييم التذكرة لـ ${ticket.userId} (DM مقفل/غادر)`);
      else console.error('Error sending ticket rating request:', e);
    });
  } catch (e) {
    console.error('Unexpected error sending ticket rating:', e);
  }
}

export async function handleTicketRating(interaction) {
  const ticketId = interaction.customId.split('_').pop();
  const ticket = await Ticket.findById(ticketId);

  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', flags: MessageFlags.Ephemeral });
  if (ticket.userId !== interaction.user.id) {
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه التقييم.', flags: MessageFlags.Ephemeral });
  }
  if (ticket.rating) {
    return interaction.reply({ content: '❌ لقد قمت بتقييم الخدمة مسبقاً.', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`rate_ticket_modal_${ticketId}`)
    .setTitle('تقييم الخدمة');

  const starsInput = new TextInputBuilder()
    .setCustomId('stars')
    .setLabel('التقييم (1-5)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(1);

  const reviewInput = new TextInputBuilder()
    .setCustomId('review')
    .setLabel('ملاحظاتك (اختياري)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(starsInput),
    new ActionRowBuilder().addComponents(reviewInput)
  );

  await interaction.showModal(modal).catch(() => {});
}

export async function handleTicketRatingSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ticketId = interaction.customId.split('_').pop();
  const stars = parseInt(interaction.fields.getTextInputValue('stars'));
  const review = interaction.fields.getTextInputValue('review');

  if (isNaN(stars) || stars < 1 || stars > 5) {
    return interaction.editReply('❌ التقييم يجب أن يكون من 1 إلى 5.');
  }

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) return interaction.editReply('❌ التذكرة غير موجودة.');

  ticket.rating = stars;
  ticket.ratingReview = review || '';
  await ticket.save();

  // تحديث التران سكربت في قناة التران سكربت بالتقيم
  try {
    if (ticket.transcriptChannelId && ticket.transcriptMessageId) {
      const config = loadConfig();
      const transcriptChannel = interaction.client.channels.cache.get(ticket.transcriptChannelId);
      if (transcriptChannel) {
        const msg = await transcriptChannel.messages.fetch(ticket.transcriptMessageId).catch(() => null);
        if (msg) {
          const embed = EmbedBuilder.from(msg.embeds[0]);
          // تحديث حقل التقييم
          const fields = embed.data.fields.map(f =>
            f.name === '⭐ التقييم' ? { name: '⭐ التقييم', value: `${'⭐'.repeat(stars)} ${stars}/5`, inline: true } : f
          );
          embed.spliceFields(0, fields.length, ...fields);
          await msg.edit({ embeds: [embed] });
        }
      }
    }
  } catch (e) {
    console.error('Error updating transcript embed with rating:', e);
  }

  await interaction.editReply('✅ **شكراً لتقييمك!** تم تسجيل تقييمك بنجاح.');
}
