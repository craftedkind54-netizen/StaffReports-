require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  ChannelType,
  MessageFlags,
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// =====================================================
// STAFF REPORTS — CONFIG
// =====================================================

const GUILD_ID = '1543363950262100118';

const REQUEST_REPORT_CHANNEL_ID = '1549136946683576380';

const SENIOR_STAFF_ROLE_ID = '1543367669385011302';
const GENERAL_STAFF_ROLE_ID = '1543373922668388482';

const REQUESTED_REPORTS_CATEGORY_ID = '1549140124854653038';
const SUBMITTED_REQUESTED_REPORTS_CHANNEL_ID = '1549140613788864563';

const REPORTS_TO_MAKE_CHANNEL_ID = '1549141254653349920';
const STAFF_CREATED_REPORTS_CHANNEL_ID = '1549141094388863126';

// Optional: add your Owner role ID in .env as OWNER_ROLE_ID.
// If you do not set it, the server owner and members with Administrator
// permission can use the owner-only request panel.
const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || null;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN in environment variables.');
  process.exit(1);
}

// =====================================================
// DATA
// =====================================================

const DATA_FILE = path.join(__dirname, 'staff-reports-data.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { requests: {}, recurrenceQueue: [] };
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    return {
      requests: parsed.requests || {},
      recurrenceQueue: parsed.recurrenceQueue || [],
    };
  } catch (error) {
    console.error('⚠️ Could not read staff-reports-data.json:', error);
    return { requests: {}, recurrenceQueue: [] };
  }
}

let data = loadData();

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('⚠️ Could not save staff-reports-data.json:', error);
  }
}

// Temporary owner form sessions.
const ownerDrafts = new Map();

// =====================================================
// CLIENT
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// =====================================================
// HELPERS
// =====================================================

function isOwnerAuthorized(member, guild) {
  if (!member) return false;

  if (guild.ownerId === member.id) return true;

  if (member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  if (OWNER_ROLE_ID && member.roles.cache.has(OWNER_ROLE_ID)) {
    return true;
  }

  return false;
}

function isStaff(member) {
  if (!member) return false;

  return (
    member.roles.cache.has(SENIOR_STAFF_ROLE_ID) ||
    member.roles.cache.has(GENERAL_STAFF_ROLE_ID)
  );
}

function sanitizeChannelName(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 75) || 'staff-report'
  );
}

function makeRequestId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function discordTime(unixSeconds) {
  return `<t:${unixSeconds}:F> • <t:${unixSeconds}:R>`;
}

function parseHours(value) {
  const number = Number(String(value).trim());
  if (!Number.isFinite(number)) return null;
  return number;
}

function parseRecurrenceToMs(value) {
  if (!value) return null;

  const text = String(value).trim().toLowerCase();

  if (
    text === 'none' ||
    text === 'no' ||
    text === 'never' ||
    text === 'n/a' ||
    text === 'na' ||
    text === '0'
  ) {
    return null;
  }

  if (text === 'daily' || text === 'every day') return 24 * 60 * 60 * 1000;
  if (text === 'weekly' || text === 'every week') return 7 * 24 * 60 * 60 * 1000;
  if (text === 'biweekly' || text === 'every 2 weeks') return 14 * 24 * 60 * 60 * 1000;
  if (text === 'monthly' || text === 'every month') return 30 * 24 * 60 * 60 * 1000;

  const match = text.match(
    /(?:every\s*)?(\d+(?:\.\d+)?)\s*(hour|hours|hr|hrs|day|days|week|weeks|month|months)/
  );

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (unit.startsWith('hour') || unit === 'hr' || unit === 'hrs') {
    return amount * 60 * 60 * 1000;
  }

  if (unit.startsWith('day')) {
    return amount * 24 * 60 * 60 * 1000;
  }

  if (unit.startsWith('week')) {
    return amount * 7 * 24 * 60 * 60 * 1000;
  }

  if (unit.startsWith('month')) {
    return amount * 30 * 24 * 60 * 60 * 1000;
  }

  return null;
}

async function fetchChannel(guild, channelId) {
  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId);
}

async function getRoleMembers(guild, roleId) {
  await guild.members.fetch();

  const role = guild.roles.cache.get(roleId);
  if (!role) return [];

  return [...role.members.values()].filter((member) => !member.user.bot);
}

async function getTargetMembers(guild, draft) {
  await guild.members.fetch();

  if (draft.targetMode === 'senior_member' || draft.targetMode === 'general_member') {
    const member = await guild.members.fetch(draft.targetUserId).catch(() => null);
    return member ? [member] : [];
  }

  if (draft.targetMode === 'all_senior') {
    return getRoleMembers(guild, SENIOR_STAFF_ROLE_ID);
  }

  if (draft.targetMode === 'all_general') {
    return getRoleMembers(guild, GENERAL_STAFF_ROLE_ID);
  }

  if (draft.targetMode === 'both_groups') {
    const seniors = await getRoleMembers(guild, SENIOR_STAFF_ROLE_ID);
    const generals = await getRoleMembers(guild, GENERAL_STAFF_ROLE_ID);

    const unique = new Map();
    for (const member of [...seniors, ...generals]) {
      unique.set(member.id, member);
    }

    return [...unique.values()];
  }

  return [];
}

async function ensureRequestPanel(guild) {
  const channel = await fetchChannel(guild, REQUEST_REPORT_CHANNEL_ID);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Request report channel is missing or is not a text channel.');
  }

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);

  const existing = messages?.find(
    (message) =>
      message.author.id === client.user.id &&
      message.components.some((row) =>
        row.components.some((component) => component.customId === 'owner_request_report')
      )
  );

  const embed = new EmbedBuilder()
    .setTitle('📋 Staff Report Requests')
    .setDescription(
      [
        'Owner panel for requesting reports from staff.',
        '',
        'You can request a report from:',
        '• One Senior Staff member',
        '• One General Staff member',
        '• All Senior Staff',
        '• All General Staff',
        '• Both staff groups',
        '',
        '**Due times use Discord timestamps, so every person sees the deadline in their own timezone.**',
        '**Minimum deadline: 24 hours from the request.**',
      ].join('\n')
    )
    .setFooter({ text: 'Staff Reports System' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('owner_request_report')
      .setLabel('Request a Report')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary)
  );

  if (existing) {
    await existing.edit({ embeds: [embed], components: [row] });
  } else {
    await channel.send({ embeds: [embed], components: [row] });
  }
}

async function ensureStaffReportPanel(guild) {
  const channel = await fetchChannel(guild, REPORTS_TO_MAKE_CHANNEL_ID);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Reports-to-make channel is missing or is not a text channel.');
  }

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);

  const existing = messages?.find(
    (message) =>
      message.author.id === client.user.id &&
      message.components.some((row) =>
        row.components.some((component) => component.customId === 'staff_create_report')
      )
  );

  const embed = new EmbedBuilder()
    .setTitle('🗂️ Staff Reports')
    .setDescription(
      [
        'Senior Staff and General Staff can create reports here.',
        '',
        'Use this for reports that were **not specifically requested by the owner**.',
        'After submission, the report is automatically sent to the staff-created reports channel.',
      ].join('\n')
    )
    .setFooter({ text: 'Staff Reports System' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('staff_create_report')
      .setLabel('Create a Report')
      .setEmoji('📄')
      .setStyle(ButtonStyle.Success)
  );

  if (existing) {
    await existing.edit({ embeds: [embed], components: [row] });
  } else {
    await channel.send({ embeds: [embed], components: [row] });
  }
}

async function createRequestedReportChannel({
  guild,
  targetMember,
  requesterId,
  reportQuestion,
  hoursUntilDue,
  originalRequestId = null,
}) {
  const requestId = originalRequestId || makeRequestId();

  const createdAt = Date.now();
  const dueAt = createdAt + hoursUntilDue * 60 * 60 * 1000;
  const dueUnix = Math.floor(dueAt / 1000);

  const requester = await guild.members.fetch(requesterId).catch(() => null);

  const channelName = sanitizeChannelName(
    `report-${targetMember.user.username}-${String(requestId).slice(-6)}`
  );

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: targetMember.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: SENIOR_STAFF_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    },
    {
      id: guild.ownerId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
      ],
    },
  ];

  if (requester && requester.id !== guild.ownerId) {
    permissionOverwrites.push({
      id: requester.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  if (OWNER_ROLE_ID) {
    permissionOverwrites.push({
      id: OWNER_ROLE_ID,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: REQUESTED_REPORTS_CATEGORY_ID,
    permissionOverwrites,
    reason: `Requested staff report for ${targetMember.user.tag}`,
  });

  data.requests[requestId] = {
    requestId,
    guildId: guild.id,
    channelId: channel.id,
    targetUserId: targetMember.id,
    requesterId,
    reportQuestion,
    createdAt,
    dueAt,
    status: 'open',
  };

  saveData();

  const embed = new EmbedBuilder()
    .setTitle('📋 Report Requested')
    .setDescription(
      [
        `${targetMember}, you have been requested to submit a staff report.`,
        '',
        `**Requested by:** <@${requesterId}>`,
        `**Report needed:** ${reportQuestion}`,
        `**Deadline:** ${discordTime(dueUnix)}`,
        '',
        'Click **Submit Report** when your report is ready.',
        'The submission form will also ask when another report should be requested.',
      ].join('\n')
    )
    .setFooter({ text: `Request ID: ${requestId}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`submit_requested_report:${requestId}`)
      .setLabel('Submit Report')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );

  await channel.send({
    content: `<@${targetMember.id}>`,
    embeds: [embed],
    components: [row],
  });

  return channel;
}

async function queueRecurringRequest({
  guildId,
  targetUserId,
  requesterId,
  reportQuestion,
  recurrenceText,
  recurrenceMs,
  dueHours,
}) {
  const nextRunAt = Date.now() + recurrenceMs;

  data.recurrenceQueue.push({
    id: makeRequestId(),
    guildId,
    targetUserId,
    requesterId,
    reportQuestion,
    recurrenceText,
    recurrenceMs,
    dueHours,
    nextRunAt,
  });

  saveData();
}

async function processRecurrenceQueue() {
  if (!client.isReady()) return;

  const now = Date.now();

  for (const item of [...data.recurrenceQueue]) {
    if (item.nextRunAt > now) continue;

    const guild = client.guilds.cache.get(item.guildId);
    if (!guild) continue;

    const targetMember = await guild.members.fetch(item.targetUserId).catch(() => null);

    if (!targetMember) {
      data.recurrenceQueue = data.recurrenceQueue.filter((x) => x.id !== item.id);
      saveData();
      continue;
    }

    try {
      await createRequestedReportChannel({
        guild,
        targetMember,
        requesterId: item.requesterId,
        reportQuestion: item.reportQuestion,
        hoursUntilDue: Math.max(24, Number(item.dueHours) || 24),
      });

      item.nextRunAt = Date.now() + item.recurrenceMs;
      saveData();
    } catch (error) {
      console.error('❌ Recurring report creation failed:', error);
    }
  }
}

// =====================================================
// READY
// =====================================================

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch();

    await ensureRequestPanel(guild);
    await ensureStaffReportPanel(guild);

    console.log('✅ Staff Reports panels are ready.');
  } catch (error) {
    console.error('❌ Startup setup error:', error);
  }

  setInterval(() => {
    processRecurrenceQueue().catch(console.error);
  }, 60 * 1000);

  processRecurrenceQueue().catch(console.error);
});

// =====================================================
// INTERACTIONS
// =====================================================

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guild || interaction.guild.id !== GUILD_ID) return;

    // -------------------------------------------------
    // OWNER: START REQUEST
    // -------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'owner_request_report') {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (!isOwnerAuthorized(member, interaction.guild)) {
        return interaction.reply({
          content: '❌ Only the server owner / authorized owner staff can request reports.',
          flags: MessageFlags.Ephemeral,
        });
      }

      ownerDrafts.set(interaction.user.id, {
        requesterId: interaction.user.id,
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId('owner_report_target_mode')
        .setPlaceholder('Choose who needs to make the report')
        .addOptions([
          {
            label: 'One Senior Staff Member',
            value: 'senior_member',
            emoji: '👤',
          },
          {
            label: 'One General Staff Member',
            value: 'general_member',
            emoji: '👤',
          },
          {
            label: 'All Senior Staff',
            value: 'all_senior',
            emoji: '👥',
          },
          {
            label: 'All General Staff',
            value: 'all_general',
            emoji: '👥',
          },
          {
            label: 'Both Staff Groups',
            value: 'both_groups',
            emoji: '📣',
          },
        ]);

      return interaction.reply({
        content: '**Step 1:** Who should receive this report request?',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // -------------------------------------------------
    // OWNER: TARGET MODE SELECT
    // -------------------------------------------------
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === 'owner_report_target_mode'
    ) {
      const draft = ownerDrafts.get(interaction.user.id);

      if (!draft) {
        return interaction.reply({
          content: '❌ This request session expired. Click **Request a Report** again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      draft.targetMode = interaction.values[0];
      ownerDrafts.set(interaction.user.id, draft);

      if (
        draft.targetMode === 'senior_member' ||
        draft.targetMode === 'general_member'
      ) {
        const userSelect = new UserSelectMenuBuilder()
          .setCustomId('owner_report_specific_user')
          .setPlaceholder('Select the staff member')
          .setMinValues(1)
          .setMaxValues(1);

        return interaction.update({
          content:
            draft.targetMode === 'senior_member'
              ? '**Step 2:** Select one Senior Staff member.'
              : '**Step 2:** Select one General Staff member.',
          components: [new ActionRowBuilder().addComponents(userSelect)],
        });
      }

      const modal = buildOwnerRequestModal();
      return interaction.showModal(modal);
    }

    // -------------------------------------------------
    // OWNER: SPECIFIC USER SELECT
    // -------------------------------------------------
    if (
      interaction.isUserSelectMenu() &&
      interaction.customId === 'owner_report_specific_user'
    ) {
      const draft = ownerDrafts.get(interaction.user.id);

      if (!draft) {
        return interaction.reply({
          content: '❌ This request session expired. Start again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const selectedUserId = interaction.values[0];
      const selectedMember = await interaction.guild.members
        .fetch(selectedUserId)
        .catch(() => null);

      if (!selectedMember) {
        return interaction.reply({
          content: '❌ I could not find that member.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const requiredRole =
        draft.targetMode === 'senior_member'
          ? SENIOR_STAFF_ROLE_ID
          : GENERAL_STAFF_ROLE_ID;

      if (!selectedMember.roles.cache.has(requiredRole)) {
        return interaction.reply({
          content:
            draft.targetMode === 'senior_member'
              ? '❌ That user does not have the Senior Staff role.'
              : '❌ That user does not have the General Staff role.',
          flags: MessageFlags.Ephemeral,
        });
      }

      draft.targetUserId = selectedUserId;
      ownerDrafts.set(interaction.user.id, draft);

      const modal = buildOwnerRequestModal();
      return interaction.showModal(modal);
    }

    // -------------------------------------------------
    // OWNER: REQUEST DETAILS MODAL
    // -------------------------------------------------
    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'owner_request_details_modal'
    ) {
      const draft = ownerDrafts.get(interaction.user.id);

      if (!draft) {
        return interaction.reply({
          content: '❌ This request session expired. Start again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const reportQuestion = interaction.fields
        .getTextInputValue('report_question')
        .trim();

      const hoursText = interaction.fields
        .getTextInputValue('hours_until_due')
        .trim();

      const hoursUntilDue = parseHours(hoursText);

      if (hoursUntilDue === null || hoursUntilDue < 24) {
        return interaction.reply({
          content:
            '❌ The deadline must be a number of hours and must be **at least 24 hours**.\nExample: `24`, `48`, or `72`.',
          flags: MessageFlags.Ephemeral,
        });
      }

      draft.reportQuestion = reportQuestion;
      draft.hoursUntilDue = hoursUntilDue;
      ownerDrafts.set(interaction.user.id, draft);

      const targets = await getTargetMembers(interaction.guild, draft);

      if (targets.length === 0) {
        return interaction.reply({
          content: '❌ No matching staff members were found.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const dueUnix = Math.floor(
        (Date.now() + hoursUntilDue * 60 * 60 * 1000) / 1000
      );

      const targetText =
        draft.targetMode === 'senior_member' ||
        draft.targetMode === 'general_member'
          ? `<@${draft.targetUserId}>`
          : draft.targetMode === 'all_senior'
          ? 'All Senior Staff'
          : draft.targetMode === 'all_general'
          ? 'All General Staff'
          : 'All Senior Staff + General Staff';

      const embed = new EmbedBuilder()
        .setTitle('✅ Confirm Report Request')
        .setDescription(
          [
            `**Who:** ${targetText}`,
            `**Report needed:** ${reportQuestion}`,
            `**Deadline:** ${discordTime(dueUnix)}`,
            `**People receiving request:** ${targets.length}`,
            '',
            'Click **Confirm Request** to create the private report channel(s).',
          ].join('\n')
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('owner_confirm_request')
          .setLabel('Confirm Request')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId('owner_cancel_request')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('✖️')
      );

      return interaction.reply({
        embeds: [embed],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    // -------------------------------------------------
    // OWNER: CONFIRM REQUEST
    // -------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'owner_confirm_request') {
      const draft = ownerDrafts.get(interaction.user.id);

      if (!draft) {
        return interaction.reply({
          content: '❌ This request session expired. Start again.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferUpdate();

      const targets = await getTargetMembers(interaction.guild, draft);

      if (targets.length === 0) {
        ownerDrafts.delete(interaction.user.id);
        return interaction.editReply({
          content: '❌ No matching staff members were found.',
          embeds: [],
          components: [],
        });
      }

      const created = [];
      const failed = [];

      for (const targetMember of targets) {
        try {
          const channel = await createRequestedReportChannel({
            guild: interaction.guild,
            targetMember,
            requesterId: interaction.user.id,
            reportQuestion: draft.reportQuestion,
            hoursUntilDue: draft.hoursUntilDue,
          });

          created.push(channel);
        } catch (error) {
          console.error(`Failed to create report channel for ${targetMember.id}:`, error);
          failed.push(targetMember);
        }
      }

      ownerDrafts.delete(interaction.user.id);

      return interaction.editReply({
        content: [
          `✅ Created **${created.length}** report request channel(s).`,
          failed.length > 0
            ? `⚠️ Failed for **${failed.length}** member(s). Check bot permissions.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        embeds: [],
        components: [],
      });
    }

    // -------------------------------------------------
    // OWNER: CANCEL REQUEST
    // -------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'owner_cancel_request') {
      ownerDrafts.delete(interaction.user.id);

      return interaction.update({
        content: '❌ Report request cancelled.',
        embeds: [],
        components: [],
      });
    }

    // -------------------------------------------------
    // REQUESTED REPORT: OPEN SUBMISSION MODAL
    // -------------------------------------------------
    if (
      interaction.isButton() &&
      interaction.customId.startsWith('submit_requested_report:')
    ) {
      const requestId = interaction.customId.split(':')[1];
      const request = data.requests[requestId];

      if (!request || request.status !== 'open') {
        return interaction.reply({
          content: '❌ This report request is no longer open.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.user.id !== request.targetUserId) {
        return interaction.reply({
          content: '❌ Only the staff member assigned to this report can submit it.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`requested_report_submit_modal:${requestId}`)
        .setTitle('Submit Staff Report');

      const reportBody = new TextInputBuilder()
        .setCustomId('report_body')
        .setLabel('Your report')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setPlaceholder('Write the completed report here...');

      const nextReport = new TextInputBuilder()
        .setCustomId('next_report_schedule')
        .setLabel('When should another report be requested?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder('Example: 7 days, weekly, 30 days, or none');

      modal.addComponents(
        new ActionRowBuilder().addComponents(reportBody),
        new ActionRowBuilder().addComponents(nextReport)
      );

      return interaction.showModal(modal);
    }

    // -------------------------------------------------
    // REQUESTED REPORT: SUBMIT
    // -------------------------------------------------
    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('requested_report_submit_modal:')
    ) {
      const requestId = interaction.customId.split(':')[1];
      const request = data.requests[requestId];

      if (!request || request.status !== 'open') {
        return interaction.reply({
          content: '❌ This report request is no longer open.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (interaction.user.id !== request.targetUserId) {
        return interaction.reply({
          content: '❌ You are not assigned to this report.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const reportBody = interaction.fields.getTextInputValue('report_body').trim();
      const nextReportSchedule = interaction.fields
        .getTextInputValue('next_report_schedule')
        .trim();

      const submittedChannel = await fetchChannel(
        interaction.guild,
        SUBMITTED_REQUESTED_REPORTS_CHANNEL_ID
      );

      if (!submittedChannel || !submittedChannel.isTextBased()) {
        return interaction.reply({
          content: '❌ The submitted reports channel is missing.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const dueUnix = Math.floor(request.dueAt / 1000);

      const embed = new EmbedBuilder()
        .setTitle('📥 Submitted Requested Report')
        .setDescription(reportBody)
        .addFields(
          {
            name: 'Staff Member',
            value: `<@${interaction.user.id}>`,
            inline: true,
          },
          {
            name: 'Requested By',
            value: `<@${request.requesterId}>`,
            inline: true,
          },
          {
            name: 'Original Deadline',
            value: discordTime(dueUnix),
            inline: false,
          },
          {
            name: 'Report Request',
            value: request.reportQuestion,
            inline: false,
          },
          {
            name: 'Next Report',
            value: nextReportSchedule,
            inline: false,
          }
        )
        .setFooter({ text: `Request ID: ${requestId}` })
        .setTimestamp();

      await submittedChannel.send({
        content: `<@${request.requesterId}>`,
        embeds: [embed],
      });

      const recurrenceMs = parseRecurrenceToMs(nextReportSchedule);

      if (recurrenceMs) {
        const originalHours = Math.max(
          24,
          Math.round((request.dueAt - request.createdAt) / (60 * 60 * 1000))
        );

        await queueRecurringRequest({
          guildId: interaction.guild.id,
          targetUserId: request.targetUserId,
          requesterId: request.requesterId,
          reportQuestion: request.reportQuestion,
          recurrenceText: nextReportSchedule,
          recurrenceMs,
          dueHours: originalHours,
        });
      }

      request.status = 'submitted';
      request.submittedAt = Date.now();
      request.nextReportSchedule = nextReportSchedule;
      saveData();

      await interaction.reply({
        content: recurrenceMs
          ? '✅ Report submitted. A future report request was scheduled based on your answer.'
          : '✅ Report submitted.',
        flags: MessageFlags.Ephemeral,
      });

      const channel = interaction.channel;

      setTimeout(async () => {
        if (channel && channel.deletable) {
          await channel
            .delete(`Staff report ${requestId} was submitted`)
            .catch(console.error);
        }
      }, 3000);

      return;
    }

    // -------------------------------------------------
    // STAFF-CREATED REPORT: OPEN MODAL
    // -------------------------------------------------
    if (interaction.isButton() && interaction.customId === 'staff_create_report') {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (!isStaff(member)) {
        return interaction.reply({
          content: '❌ Only General Staff or Senior Staff can create reports here.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('staff_created_report_modal')
        .setTitle('Create Staff Report');

      const title = new TextInputBuilder()
        .setCustomId('staff_report_title')
        .setLabel('Report title / topic')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(150)
        .setPlaceholder('What is this report about?');

      const body = new TextInputBuilder()
        .setCustomId('staff_report_body')
        .setLabel('Report')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(4000)
        .setPlaceholder('Write your report here...');

      modal.addComponents(
        new ActionRowBuilder().addComponents(title),
        new ActionRowBuilder().addComponents(body)
      );

      return interaction.showModal(modal);
    }

    // -------------------------------------------------
    // STAFF-CREATED REPORT: SUBMIT
    // -------------------------------------------------
    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'staff_created_report_modal'
    ) {
      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (!isStaff(member)) {
        return interaction.reply({
          content: '❌ Only staff can submit this report.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const title = interaction.fields.getTextInputValue('staff_report_title').trim();
      const body = interaction.fields.getTextInputValue('staff_report_body').trim();

      const destination = await fetchChannel(
        interaction.guild,
        STAFF_CREATED_REPORTS_CHANNEL_ID
      );

      if (!destination || !destination.isTextBased()) {
        return interaction.reply({
          content: '❌ The staff-created reports destination channel is missing.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const roleName = member.roles.cache.has(SENIOR_STAFF_ROLE_ID)
        ? 'Senior Staff'
        : 'General Staff';

      const embed = new EmbedBuilder()
        .setTitle(`📄 ${title}`)
        .setDescription(body)
        .addFields(
          {
            name: 'Submitted By',
            value: `<@${interaction.user.id}>`,
            inline: true,
          },
          {
            name: 'Staff Group',
            value: roleName,
            inline: true,
          }
        )
        .setTimestamp();

      await destination.send({ embeds: [embed] });

      return interaction.reply({
        content: '✅ Your report was submitted.',
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (error) {
    console.error('❌ Interaction error:', error);

    if (interaction.deferred || interaction.replied) {
      await interaction
        .followUp({
          content: '❌ Something went wrong. Check the bot console for details.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    } else {
      await interaction
        .reply({
          content: '❌ Something went wrong. Check the bot console for details.',
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }
});

// =====================================================
// MODAL BUILDERS
// =====================================================

function buildOwnerRequestModal() {
  const modal = new ModalBuilder()
    .setCustomId('owner_request_details_modal')
    .setTitle('Request a Staff Report');

  const reportQuestion = new TextInputBuilder()
    .setCustomId('report_question')
    .setLabel('What report do you need?')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('Explain exactly what information you need in the report.');

  const hoursUntilDue = new TextInputBuilder()
    .setCustomId('hours_until_due')
    .setLabel('Hours until due — minimum 24')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(10)
    .setPlaceholder('Example: 24, 48, 72');

  modal.addComponents(
    new ActionRowBuilder().addComponents(reportQuestion),
    new ActionRowBuilder().addComponents(hoursUntilDue)
  );

  return modal;
}

// =====================================================
// LOGIN
// =====================================================

client.login(DISCORD_TOKEN);
