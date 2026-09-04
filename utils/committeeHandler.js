import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, EmbedBuilder } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { commandRegistry, getCommandInfo, getButtonInfo, getModalInfo } from './actionRegistry.js';
import { committees as permCommittees, getCommitteesForCommand, getCommitteesForButton, isElevatedCommand, isElevatedButton } from './committeePermissions.js';
import PersistentMessage from '../models/PersistentMessage.js';
import { info as embedInfo, gold as embedGold, custom as embedCustom } from './embedStyles.js';
import { loadConfig, clearConfigCache } from './configLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const committeeDataPath = join(__dirname, '../.data/Committees.json');
const configPath = join(__dirname, '../config.json');

const COMMITTEE_COLORS = {
  punishment: 0xE74C3C,
  interaction: 0x3498DB,
  promotion: 0x2ECC71,
  family_presidency: 0xF1C40F,
  blackMarket: 0x2C3E50,
};

const COMMITTEE_EMOJIS = {
  punishment: '🛡️',
  interaction: '📋',
  promotion: '🎖️',
  family_presidency: '👑',
  blackMarket: '🏴‍☠️',
};

function loadCommittees() {
  try {
    if (!existsSync(committeeDataPath)) return null;
    return JSON.parse(readFileSync(committeeDataPath, 'utf8'));
  } catch { return null; }
}

function saveCommittees(list) {
  writeFileSync(committeeDataPath, JSON.stringify(list, null, 2), 'utf8');
}

function saveConfig(config) {
    try {
        if (config.committees?.list && Object.keys(config.committees.list).length > 0) {
            saveCommittees(config.committees.list);
        }
        const toSave = JSON.parse(JSON.stringify(config));
        if (toSave.committees) delete toSave.committees.list;
        writeFileSync(configPath, JSON.stringify(toSave, null, 2), 'utf8');
        clearConfigCache();
    } catch (err) {
        console.error('❌ Failed to save config.json', err);
    }
}

async function findCommitteeByInteraction(interaction, config) {
  // 1. Try finding by message ID first via PersistentMessage
  if (interaction.message?.id) {
    try {
      const pMsg = await PersistentMessage.findOne({ messageId: interaction.message.id });
      if (pMsg) {
        const key = pMsg.key.replace('committeePanel_', '');
        const committee = config.committees?.list?.[key];
        if (committee) return [key, committee];
      }
    } catch (e) {
      console.error('Error finding committee by message ID:', e);
    }
  }

  // 2. Try by channelId or threadId directly
  const committeeList = config.committees?.list || {};
  const directMatch = Object.entries(committeeList).find(([k, v]) =>
    v.channelId === interaction.channelId || v.threadId === interaction.channelId
  );
  if (directMatch) return directMatch;

  // 3. Try by parent channel ID (if it's a thread or sub-channel)
  const channel = interaction.channel;
  if (channel) {
    const parentId = channel.parentId || channel.parent?.id;
    if (parentId) {
      const parentMatch = Object.entries(committeeList).find(([k, v]) =>
        v.channelId === parentId || v.threadId === parentId
      );
      if (parentMatch) return parentMatch;
    }
  }

  return null;
}

async function manageCommitteeThread(guild, threadId, memberId, action) {
    if (!threadId) return;
    try {
        const thread = await guild.channels.fetch(threadId).catch(() => null);
        if (!thread) return;
        if (action === 'add') await thread.members.add(memberId);
        else if (action === 'remove') await thread.members.remove(memberId);
    } catch (e) {
        if (e.code !== 10003 && e.code !== 50001) {
            console.error(`❌ Thread ${action} error (thread: ${threadId}, member: ${memberId}):`, e.message);
        }
    }
}

/* ===================================================================
   نظام الصلاحيات الموحد - Unified Permission System
   يعتمد على utils/committeePermissions.js كمصدر وحيد للصلاحيات
   =================================================================== */

/**
 * التحقق من أساسيات: هل العضو مؤسس أو مصرح له أو من الرئاسة؟
 */
function isSuperUser(member, config) {
    const userId = member.id;
    if ((config.committees?.founders || []).includes(userId)) return { allowed: true, committee: null, reason: 'مؤسس' };
    if ((config.committees?.authorizedUsers || []).includes(userId)) return { allowed: true, committee: null, reason: 'مصرح له' };
    const presidency = config.committees?.list?.family_presidency;
    if (presidency?.roles) {
        const allPresidencyRoles = [
            ...(presidency.roles.manager || []),
            ...(presidency.roles.deputy || []),
            ...(presidency.roles.member || []),
        ];
        for (const r of allPresidencyRoles) {
            if (r === userId || member.roles?.cache?.has(r)) return { allowed: true, committee: 'family_presidency', reason: 'عضوية الرئاسة' };
        }
    }
    return null;
}

/**
 * هل العضو في اللجنة؟ وأي رتبة؟
 */
function getMemberRoleInCommittee(member, committeeKey, config) {
    const committee = config.committees?.list?.[committeeKey];
    if (!committee) return null;
    const userId = member.id;
    const roles = committee.roles || {};
    if ((roles.manager || []).some(r => r === userId || member.roles?.cache?.has(r))) return { role: 'manager', committee, key: committeeKey };
    if ((roles.deputy || []).some(r => r === userId || member.roles?.cache?.has(r))) return { role: 'deputy', committee, key: committeeKey };
    if ((roles.member || []).some(r => r === userId || member.roles?.cache?.has(r))) return { role: 'member', committee, key: committeeKey };
    return null;
}

/**
 * التحقق من صلاحية أمر بناءً على committeePermissions.js
 * @param {GuildMember} member
 * @param {string} itemType - 'command' أو 'button'
 * @param {string} itemName - اسم الأمر أو customId الزر
 * @returns {{ allowed: boolean, committee: string|null, reason: string }}
 */
export function checkPermission(member, itemType, itemName) {
    const config = loadConfig();

    // 1. Super users
    const superCheck = isSuperUser(member, config);
    if (superCheck) return superCheck;

    // 2. البحث عن اللجان التي تملك هذا الأمر/الزر
    let committeeKeys = [];
    if (itemType === 'command') {
        committeeKeys = getCommitteesForCommand(itemName);
        // إذا ما لقيناها كـ command name, نجرب البحث في actionRegistry (backward compat)
        if (committeeKeys.length === 0) {
            for (const [cmdName, cmdInfo] of Object.entries(commandRegistry)) {
                if (cmdInfo.action === itemName) {
                    const keys = getCommitteesForCommand(cmdName);
                    committeeKeys.push(...keys);
                }
            }
        }
    } else if (itemType === 'button') {
        committeeKeys = getCommitteesForButton(itemName);
    }

    // 3. إذا ما في لجنة تملك هذا الأمر/الزر → أمر عام
    if (committeeKeys.length === 0) {
        return { allowed: true, committee: null, reason: 'عام' };
    }

    // 4. هل العضو في إحدى هذه اللجان؟
    for (const key of committeeKeys) {
        const membership = getMemberRoleInCommittee(member, key, config);
        if (membership) {
            // تحقق من الأوامر المقيدة (تحتاج manager/deputy)
            if (membership.role === 'member') {
                const elevated = itemType === 'command'
                    ? isElevatedCommand(itemName)
                    : isElevatedButton(itemName);
                if (elevated) {
                    return { allowed: false, committee: key, reason: `هذا الأمر يحتاج مسؤول أو نائب في ${membership.committee.name}` };
                }
            }
            return { allowed: true, committee: key, reason: `عضو في ${membership.committee.name}` };
        }
    }

    const committeeNames = committeeKeys.map(k => config.committees?.list?.[k]?.name || k).join(' أو ');
    return { allowed: false, committee: null, reason: `لا تملك الصلاحية لهذا الأمر، أنت تحتاج إلى أن تكون في ${committeeNames}` };
}

/**
 * التحقق من صلاحية أمر سلاش
 */
export function checkCommandPermission(member, commandName) {
    return checkPermission(member, 'command', commandName);
}

/**
 * التحقق من صلاحية زر
 */
export function checkButtonPermission(member, customId) {
    return checkPermission(member, 'button', customId);
}

/**
 * إصدار قديم للتوافق مع الأكواد الموجودة
 * (يستخدم اسم الأمر أو الـ action)
 */
export function checkCommitteePermission(member, actionOrCommand) {
    const result = checkCommandPermission(member, actionOrCommand);
    return result.allowed;
}

/* ===================================================================
   نظام إدارة اللجان - Committee Management Hierarchy
   =================================================================== */

/**
 * التحقق من صلاحية إدارة أعضاء لجنة معينة
 * @param {GuildMember} member - العضو الذي يقوم بالإدارة
 * @param {string} targetCommitteeKey - مفتاح اللجنة المستهدفة
 * @param {'manager'|'deputy'|'member'} targetRole - المنصب المستهدف (إضافة/إزالة)
 * @returns {{ allowed: boolean, reason: string, role: string|null }}
 *
 * الـ Hierarchy:
 *   الرئاسة ← كل الصلاحيات على كل اللجان
 *   مسؤول لجنة ← يضيف/يزيل نائب وعضو في لجنته فقط
 *   نائب لجنة ← يضيف/يزيل عضو فقط في لجنته فقط
 *   عضو لجنة ← لا صلاحية إدارية
 */
export function checkManagePermission(member, targetCommitteeKey, targetRole) {
    const config = loadConfig();
    const userId = member.id;

    // 1. الرئاسة تمرر كل شيء
    const superCheck = isSuperUser(member, config);
    if (superCheck) return { allowed: true, reason: 'الرئاسة', role: 'presidency' };

    // 2. التحقق من عضوية المستهدف في اللجنة
    const membership = getMemberRoleInCommittee(member, targetCommitteeKey, config);
    if (!membership) {
        return { allowed: false, reason: 'لست عضواً في هذه اللجنة', role: null };
    }

    const userRole = membership.role;

    // 3. العضو العادي لا يمكنه الإدارة
    if (userRole === 'member') {
        return { allowed: false, reason: 'أعضاء اللجنة العاديين لا يمكنهم إدارة الأعضاء', role: userRole };
    }

    // 4. النائب يمكنه إدارة الأعضاء فقط
    if (userRole === 'deputy') {
        if (targetRole === 'manager' || targetRole === 'deputy') {
            return { allowed: false, reason: 'النائب لا يمكنه تعديل المسؤولين أو النواب', role: userRole };
        }
        return { allowed: true, reason: `نائب في ${membership.committee.name}`, role: userRole };
    }

    // 5. المسؤول يمكنه إدارة الكل في لجنته
    if (userRole === 'manager') {
        if (targetRole === 'manager') {
            return { allowed: false, reason: 'لا يمكنك تعديل مسؤول اللجنة. الرئاسة فقط.', role: userRole };
        }
        return { allowed: true, reason: `مسؤول في ${membership.committee.name}`, role: userRole };
    }

    return { allowed: false, reason: 'لا تملك صلاحية الإدارة', role: null };
}

/* ===================================================================
   دوال اللجان (لوحات العرض)
   =================================================================== */

function createCommitteeEmbed(guild, committeeKey, committee) {
    const config = loadConfig();
    const emoji = COMMITTEE_EMOJIS[committeeKey] || '🏛️';
    const color = COMMITTEE_COLORS[committeeKey] || 0x2B2D31;
    const memberEmoji = committeeKey === 'family_presidency' ? '👑 أعضاء الرئاسة' : '👥 أعضاء اللجنة';
    const isPresidency = committeeKey === 'family_presidency';

    const managers = (committee.roles?.manager || []).map(id => `<@${id}>`);
    const deputies = (committee.roles?.deputy || []).map(id => `<@${id}>`);
    const members = (committee.roles?.member || []).map(id => `<@${id}>`);
    const totalMembers = managers.length + deputies.length + members.length;

    let desc = '';
    desc += `${emoji} 𓆩𝐗.𝐈𝐑𝐀𝐐 𝐅𝐀𝐌𝐈𝐋𝐘 𓆪 — ${committee.name}\n\n`;
    desc += '━━━━━━━━━━━━━━━━━━━━\n';
    desc += '📌 **الصلاحيات**\n';
    desc += `${(committee.allowedActions || []).map(a => `🞄 ${a === 'ALL' ? 'إدارة كاملة' : a}`).join('\n') || '🞄 مهام عامة'}`;
    desc += '\n━━━━━━━━━━━━━━━━━━━━\n';

    if (!isPresidency) {
        desc += `👑 المسؤول  ·  🌟 النائب  ·  👥 الأعضاء\n`;
        desc += '━━━━━━━━━━━━━━━━━━━━\n';
    }

    if (isPresidency) {
        desc += `${memberEmoji}:\n${members.join(' ') || 'لا يوجد'}\n`;
    } else {
        if (managers.length > 0) desc += `👑 المسؤول: ${managers.join(' ')}\n`;
        if (deputies.length > 0) desc += `🌟 النائب: ${deputies.join(' ')}\n`;
        const memberList = members.length > 10
            ? `${members.slice(0, 10).join(' ')} +${members.length - 10}`
            : members.join(' ');
        desc += `👥 الأعضاء: ${memberList || 'لا يوجد'}\n`;
    }

    const founders = (config.committees?.founders || []).map(id => `<@${id}>`);
    if (founders.length > 0) {
        desc += '\n━━━━━━━━━━━━━━━━━━━━\n';
        desc += `💎 المؤسسين: ${founders.join(' ')}\n`;
    }

    desc += '\n━━━━━━━━━━━━━━━━━━━━\n';
    desc += `👥 **${totalMembers}** أعضاء`;
    if (!isPresidency) {
        desc += `  |  👑 ${managers.length} مسؤول  |  🌟 ${deputies.length} نائب  |  👥 ${members.length} عضو`;
    }

    const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(desc)
        .setFooter({ text: `🕐 آخر تحديث: ${new Date().toLocaleString('ar-IQ', { timeZone: 'Asia/Baghdad', dateStyle: 'medium', timeStyle: 'short' })}` })
        .setTimestamp();

    return embed;
}

export async function refreshCommitteePanel(guild, committeeKey) {
    const config = loadConfig();
    const committee = config.committees?.list?.[committeeKey];
    if (!committee || !committee.channelId || committee.channelId.startsWith('REPLACE')) return;

    try {
        const channel = await guild.channels.fetch(committee.channelId).catch(() => null);
        if (!channel) return;

        const embed = createCommitteeEmbed(guild, committeeKey, committee);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('committee_control_btn')
                .setStyle(ButtonStyle.Primary)
                .setLabel(committeeKey === 'family_presidency' ? '⚙️ التحكم المركزي' : '⚙️ التحكم'),
            new ButtonBuilder()
                .setCustomId('cmd_show_panel')
                .setStyle(ButtonStyle.Secondary)
                .setLabel('⚡ الأوامر'),
            new ButtonBuilder()
                .setCustomId('comm_refresh_panel')
                .setStyle(ButtonStyle.Success)
                .setLabel('🔄 تحديث'),
        );

        const pMsg = await PersistentMessage.findOne({ key: `committeePanel_${committeeKey}` });
        let message = pMsg ? await channel.messages.fetch(pMsg.messageId).catch(() => null) : null;

        if (message) {
            const editResult = await message.edit({ embeds: [embed], components: [row] }).catch(err => err);
            if (editResult instanceof Error) {
                if (editResult.code === 10008) {
                    message = null;
                } else {
                    if (editResult.code !== 10003 && editResult.code !== 50001) {
                        console.error(`❌ [CommitteePanel] edit error ${committeeKey}:`, editResult.message);
                    }
                    return;
                }
            }
        }

        if (!message) {
            const newMsg = await channel.send({ embeds: [embed], components: [row] });
            await PersistentMessage.findOneAndUpdate(
                { key: `committeePanel_${committeeKey}` },
                { key: `committeePanel_${committeeKey}`, guildId: guild.id, channelId: channel.id, messageId: newMsg.id, updatedAt: new Date() },
                { upsert: true }
            );
            if (committee.messageId) {
                committee.messageId = null;
                saveConfig(config);
            }
        }

    } catch (err) {
        console.error(`❌ Failed to refresh panel for ${committeeKey}:`, err);
    }
}

export async function refreshAllCommitteePanels(client) {
    const config = loadConfig();
    const guildId = config.bot.guildId;
    if (!guildId) return;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    console.log('🔄 Started refreshing committee panels...');
    for (const key of Object.keys(config.committees?.list || {})) {
        await refreshCommitteePanel(guild, key);
        await new Promise(r => setTimeout(r, 800));
    }
    console.log('✅ All committee panels refreshed.');
}

export async function handleCommitteeInteraction(interaction) {
    const { customId } = interaction;
    try {
        if (customId === 'committee_control_btn') await showControlPanel(interaction);
        else if (customId === 'comm_add_person') await startAddPersonFlow(interaction);
        else if (customId === 'comm_remove_person') await startRemovePersonFlow(interaction);
        else if (customId === 'comm_show_members') await showCommitteeMembers(interaction);
        else if (customId === 'comm_add_user_id_modal') await handleAddUserIdSubmit(interaction);
        else if (customId.startsWith('comm_sel_dept_')) await handleCommitteeSelection(interaction);
        else if (customId.startsWith('comm_sel_pos_')) await handlePositionSelection(interaction);
        else if (customId === 'comm_remove_user_modal') await processRemovePerson(interaction);
        else if (customId === 'comm_interaction_review') await handleInteractionReview(interaction);
        else if (customId === 'comm_refresh_panel') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
            const config = loadConfig();
            const committeeEntry = await findCommitteeByInteraction(interaction, config);
            if (!committeeEntry) return interaction.editReply('❌ هذه القناة غير مرتبطة بأي لجنة.').catch(() => {});
            const [key] = committeeEntry;
            await refreshCommitteePanel(interaction.guild, key);
            await interaction.editReply('✅ تم تحديث اللوحة.').catch(() => {});
        }
    } catch (err) {
        const ignore = [10008, 10062, 40060, 50001, 'UND_ERR_SOCKET', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT'];
        if (err.code && ignore.includes(err.code)) return;
        console.error('❌ Interaction Error in committeeHandler:', err);
    }
}

async function showControlPanel(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });
    const config = loadConfig();
    const committeeEntry = await findCommitteeByInteraction(interaction, config);
    if (!committeeEntry) return interaction.editReply({ content: '❌ هذه القناة غير مرتبطة بأي لجنة.' }).catch(() => { });
    const [key, committee] = committeeEntry;

    // التحقق من الرتبة
    const membership = getMemberRoleInCommittee(interaction.member, key, config);
    const superCheck = isSuperUser(interaction.member, config);
    if (!superCheck && (!membership || membership.role === 'member')) {
        return interaction.editReply({ content: '❌ لا تملك صلاحية التحكم بهذه اللجنة.' }).catch(() => { });
    }

    const role = superCheck ? 'presidency' : membership.role;
    const components = [];

    // عرض الأزرار حسب الرتبة
    if (role === 'presidency' || role === 'manager') {
        // المسؤول + الرئاسة: إضافة/إزالة أعضاء ونواب
        components.push(
            new ButtonBuilder().setCustomId('comm_add_person').setLabel('➕ إضافة عضو').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('comm_remove_person').setLabel('➖ إزالة عضو').setStyle(ButtonStyle.Danger),
        );
    } else if (role === 'deputy') {
        // النائب: إضافة/إزالة أعضاء فقط
        components.push(
            new ButtonBuilder().setCustomId('comm_add_person').setLabel('➕ إضافة عضو').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('comm_remove_person').setLabel('➖ إزالة عضو').setStyle(ButtonStyle.Danger),
        );
    }

    components.push(
        new ButtonBuilder().setCustomId('comm_show_members').setLabel('📋 عرض الأعضاء').setStyle(ButtonStyle.Secondary)
    );

    if (key === 'interaction') {
        components.push(
            new ButtonBuilder().setCustomId('comm_interaction_review').setLabel('🔍 مراجعة التفاعل').setStyle(ButtonStyle.Primary)
        );
    }

    const row = new ActionRowBuilder().addComponents(components);
    await interaction.editReply({ content: `🛠️ **تحكم بـ ${committee.name}**`, components: [row] }).catch(() => { });
}

async function startAddPersonFlow(interaction) {
    const modal = new ModalBuilder().setCustomId('comm_add_user_id_modal').setTitle('إضافة شخص للجنة');
    const input = new TextInputBuilder().setCustomId('target_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal).catch(e => console.error('❌ showModal Failed:', e));
}

async function handleAddUserIdSubmit(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });
    const targetId = interaction.fields.getTextInputValue('target_id');
    const config = loadConfig();
    const superCheck = isSuperUser(interaction.member, config);
    const currentCommitteeEntry = await findCommitteeByInteraction(interaction, config);
    if (!currentCommitteeEntry) return interaction.editReply({ content: '❌ خطأ في القناة.' }).catch(() => { });
    const [currentKey, currentComm] = currentCommitteeEntry;

    // الرئاسة: يمكنها الإضافة لأي لجنة بأي منصب
    if (superCheck) {
        const options = Object.entries(config.committees?.list || {}).map(([k, c]) => ({ label: c.name, value: k }));
        const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`comm_sel_dept_${targetId}`).setPlaceholder('اختر اللجنة').addOptions(options));
        return await interaction.editReply({ content: `👤 <@${targetId}>\n**اختر اللجنة المُراد الإضافة إليها:**`, components: [row] }).catch(() => { });
    }

    // التحقق من صلاحية إدارة اللجنة
    const membership = getMemberRoleInCommittee(interaction.member, currentKey, config);
    if (!membership || membership.role === 'member') {
        return interaction.editReply({ content: '❌ لا تملك صلاحية إضافة أعضاء لهذه اللجنة.' }).catch(() => { });
    }

    // تحديد المناصب المسموحة حسب الرتبة
    const allowedPositions = [];
    if (membership.role === 'manager') {
        // مسؤول: يقدر يضيف نائب أو عضو
        allowedPositions.push({ label: 'عضو لجنة', value: 'member' });
        allowedPositions.push({ label: 'نائب مسؤول', value: 'deputy' });
    } else if (membership.role === 'deputy') {
        // نائب: يقدر يضيف عضو فقط
        allowedPositions.push({ label: 'عضو لجنة', value: 'member' });
    } else {
        return interaction.editReply({ content: '❌ لا تملك صلاحية إضافة أعضاء.' }).catch(() => { });
    }

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`comm_sel_pos_${targetId}_${currentKey}`)
            .setPlaceholder('اختر المنصب')
            .addOptions(allowedPositions)
    );
    await interaction.editReply({ content: `👤 <@${targetId}>\nاللجنة: **${currentComm.name}**`, components: [row] }).catch(() => { });
}

async function handleCommitteeSelection(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => { });
    const targetId = interaction.customId.split('_').pop();
    const selectedKey = interaction.values[0];
    const config = loadConfig();
    const options = selectedKey === 'family_presidency' ? [{ label: 'عضو رئاسة', value: 'member' }] :
        [{ label: 'مسؤول لجنة', value: 'manager' }, { label: 'نائب مسؤول', value: 'deputy' }, { label: 'عضو لجنة', value: 'member' }];
    const row = new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`comm_sel_pos_${targetId}_${selectedKey}`).setPlaceholder('المنصب').addOptions(options));
    await interaction.editReply({ content: `👤 <@${targetId}>\nاللجنة: **${config.committees?.list?.[selectedKey]?.name || selectedKey}**`, components: [row] }).catch(() => { });
}

async function handlePositionSelection(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(() => { });
    const parts = interaction.customId.split('_');
    const targetId = parts[3];
    const commKey = parts.slice(4).join('_');
    const position = interaction.values[0];

    const config = loadConfig();

    // الرئاسة: يمكنها التعديل على أي لجنة بأي منصب
    const superCheck = isSuperUser(interaction.member, config);
    if (!superCheck) {
        // التحقق من صلاحية الإدارة للمنصب المطلوب
        const perm = checkManagePermission(interaction.member, commKey, position);
        if (!perm.allowed) {
            return interaction.editReply({ content: `❌ ${perm.reason}`, components: [] }).catch(() => { });
        }
    }

    // الرئاسة فقط أو المصرح لهم يمكنهم تعديل الرئاسة
    const canEditPresidency = (config.committees?.founders || []).includes(interaction.user.id) ||
                              (config.committees?.authorizedUsers || []).includes(interaction.user.id);
    if (commKey === 'family_presidency' && !canEditPresidency) {
        return interaction.editReply({ content: '❌ المؤسسون أو المصرح لهم فقط يمكنهم التعديل على الرئاسة.', components: [] }).catch(() => { });
    }

    const committee = config.committees?.list?.[commKey];
    if (!committee) return interaction.editReply({ content: `❌ خطأ في التعرف على اللجنة: ${commKey}`, components: [] }).catch(() => { });

    if (!committee.roles) committee.roles = {};
    if (!committee.roles[position]) committee.roles[position] = [];
    if (!committee.roles[position].includes(targetId)) committee.roles[position].push(targetId);

    saveConfig(config);
    await manageCommitteeThread(interaction.guild, committee.threadId, targetId, 'add');
    await interaction.editReply({ content: `✅ تم إضافة <@${targetId}> في ${committee.name}.`, components: [] }).catch(() => { });
    await refreshCommitteePanel(interaction.guild, commKey);
    sendAuditLog(interaction.guild, config, '➕ إضافة', committee.name, targetId, position, interaction.user.id);
}

async function startRemovePersonFlow(interaction) {
    const modal = new ModalBuilder().setCustomId('comm_remove_user_modal').setTitle('إزالة شخص');
    const input = new TextInputBuilder().setCustomId('remove_target_id').setLabel('User ID').setStyle(TextInputStyle.Short).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal).catch(e => console.error('❌ showModal Failed:', e));
}

async function processRemovePerson(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });
    const targetId = interaction.fields.getTextInputValue('remove_target_id');
    const config = loadConfig();
    const committeeEntry = await findCommitteeByInteraction(interaction, config);
    if (!committeeEntry) return interaction.editReply('❌ هذه القناة غير مرتبطة بأي لجنة.').catch(() => { });
    const [key, committee] = committeeEntry;

    // المؤسسون أو المصرح لهم فقط يمكنهم الحذف من الرئاسة
    const canEditPresidency = (config.committees?.founders || []).includes(interaction.user.id) ||
                              (config.committees?.authorizedUsers || []).includes(interaction.user.id);
    if (key === 'family_presidency' && !canEditPresidency) {
        return interaction.editReply('❌ المؤسسون أو المصرح لهم فقط يمكنهم الحذف من الرئاسة.').catch(() => { });
    }

    // تحديد المنصب المستهدف للحذف
    let targetPosition = null;
    if (committee.roles) {
        for (const pos of Object.keys(committee.roles)) {
            if (committee.roles[pos].includes(targetId)) {
                targetPosition = pos;
                break;
            }
        }
    }
    if (!targetPosition) return interaction.editReply('❌ هذا الشخص ليس عضواً في اللجنة.').catch(() => { });

    // التحقق من صلاحية الحذف حسب المنصب
    const superCheck = isSuperUser(interaction.member, config);
    if (!superCheck) {
        const perm = checkManagePermission(interaction.member, key, targetPosition);
        if (!perm.allowed) {
            return interaction.editReply(`❌ ${perm.reason}`).catch(() => { });
        }
    }

    committee.roles[targetPosition] = committee.roles[targetPosition].filter(id => id !== targetId);
    saveConfig(config);
    await manageCommitteeThread(interaction.guild, committee.threadId, targetId, 'remove');
    await interaction.editReply(`✅ تم حذف <@${targetId}> من ${committee.name}.`).catch(() => { });
    await refreshCommitteePanel(interaction.guild, key);
    sendAuditLog(interaction.guild, config, '➖ إزالة', committee.name, targetId, targetPosition, interaction.user.id);
}

async function showCommitteeMembers(interaction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });
    const config = loadConfig();
    const committeeEntry = await findCommitteeByInteraction(interaction, config);
    if (!committeeEntry) return interaction.editReply('❌ هذه القناة غير مرتبطة بأي لجنة.').catch(() => { });
    const [key, committee] = committeeEntry;
    const membFields = [];
    const man = (committee.roles?.manager || []).length > 0 ? committee.roles.manager.map(id => `<@${id}>`).join('\n') : 'لا يوجد';
    const dep = (committee.roles?.deputy || []).length > 0 ? committee.roles.deputy.map(id => `<@${id}>`).join('\n') : 'لا يوجد';
    const mem = (committee.roles?.member || []).length > 0 ? committee.roles.member.map(id => `<@${id}>`).join('\n') : 'لا يوجد';
    if (key === 'family_presidency') membFields.push({ name: '👥 الأعضاء', value: mem });
    else membFields.push({ name: '👑 المسؤولين', value: man, inline: true }, { name: '🌟 النواب', value: dep, inline: true }, { name: '👥 الأعضاء', value: mem });
    const fnd = (config.committees?.founders || []);
    if (fnd.length > 0) membFields.push({ name: '💎 المؤسسين', value: fnd.map(id => `<@${id}>`).join(' , ') });
    const embed = embedInfo(`👥 أعضاء ${committee.name}`, null, membFields);
    await interaction.editReply({ embeds: [embed] }).catch(() => { });
}

async function sendAuditLog(guild, config, action, committeeName, targetId, position, executorId) {
    const auditId = config.committees?.auditLogChannelId;
    const channelId = auditId || null;
    if (!channelId) return;
    try {
        const positionLabel = position === 'manager' ? 'مسؤول' : position === 'deputy' ? 'نائب' : 'عضو';
        const embed = embedCustom(action === '➕ إضافة' ? '#00FF00' : '#FF0000',
            `${action} عضو ${action === '➕ إضافة' ? 'في' : 'من'} اللجنة`,
            `**اللجنة:** ${committeeName}\n**العضو:** <@${targetId}>\n**المنصب:** ${positionLabel}\n**بواسطة:** <@${executorId}>`);
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        console.error('❌ Audit log error:', e.message);
    }
}

async function handleInteractionReview(interaction) {
    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    try {
        const { runManualReview } = await import('./interactionSystem.js');
        
        await interaction.editReply({ content: '⏳ جاري تشغيل مراجعة التفاعل لجميع الأعضاء وتحديث إيموجيات الرومات... قد يستغرق هذا بضع ثوانٍ.' }).catch(() => {});
        
        const result = await runManualReview(interaction.guild, interaction.client);
        
        const counts = result.statusCounts || {};
        const description = `━━━━━━━━━━━━━━━━━━━━\n🟢 **متفاعلين عالي:** ${counts.active_high || 0} عضو\n🟡 **خاملين:** ${counts.inactive || 0} أعضاء\n🔴 **مخالفين جدد:** ${counts.violator || 0} عضو ← يُرسل للإدارة\n🟤 **مخالفين محذرين:** ${counts.warned || 0} عضو ← جاهز للفصل\n⚫ **محميون:** ${counts.protected || 0} أعضاء\n🆕 **فترة سماح:** ${counts.grace || 0} عضو\n━━━━━━━━━━━━━━━━━━━━\n✅ تم فحص وتصنيف **${result.processed || 0}** عضو نشط.\n🏠 تم تحديث إيموجيات رومات لـ **${result.roomUpdates || 0}** عضو.`;
        const embed = embedInfo('📊 نتائج مراجعة التفاعل اليدوية', description);
            
        await interaction.editReply({ content: '✅ تم الانتهاء من مراجعة التفاعل!', embeds: [embed] }).catch(() => {});
        
    } catch (error) {
        console.error('❌ خطأ في مراجعة التفاعل اليدوية:', error);
        await interaction.editReply({ content: `❌ حدث خطأ أثناء تشغيل مراجعة التفاعل:\n${error.message}` }).catch(() => {});
    }
}
