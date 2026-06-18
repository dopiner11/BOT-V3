import Ticket from '../models/Ticket.js';
import { MessageFlags } from 'discord.js';

export async function closeTicketWithReason(interaction, ticketNumber, reason) {
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
            // We need to fetch messages, etc.
            // Re-use logic from closeDeleteForever or similar, but simpler:
            // Or better, just use the existing logic inside `closeTicketWithReason` 
            // effectively merging close logic.

            // Import and use saveTranscriptWithLinks
            const { saveTranscriptWithLinks } = await import('./ticketManager.js');
            const transcriptData = await saveTranscriptWithLinks(ticketChannel, ticket, reason, interaction.user.id);

            let htmlBuffer = null;
            if (transcriptData) {
                htmlBuffer = createDiscordTranscript(transcriptData.messages, ticket, transcriptData, interaction.user.tag);
            }

            // 3. Send Transcript to Channel
            const { sendTranscriptToChannel } = await import('./ticketManager.js');
            await sendTranscriptToChannel(interaction.guild, ticket, transcriptData, htmlBuffer);

            // 4. Send Transcript to User
            const { sendTranscriptToTicketOwner } = await import('./ticketManager.js');
            await sendTranscriptToTicketOwner(interaction.client, ticket, transcriptData, htmlBuffer);

            // 5. Notify in channel within 5 seconds then delete
            await ticketChannel.send({
                content: `🔒 **تم إغلاق التذكرة بواسطة <@${interaction.user.id}>**\n📝 **السبب:** ${reason}\n\n🗑️ سيتم حذف القناة خلال 5 ثوانٍ...`
            });

            setTimeout(async () => {
                await ticketChannel.delete().catch(() => { });
            }, 5000);
        }

    } catch (error) {
        console.error('Error closing ticket with reason:', error);
    }
}
