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
// CRAFTED SMP STAFF REPORTS
// =====================================================

const GUILD_ID = '1543363950262100118';

// =====================================================
// STAFF ROLES
// =====================================================

const SENIOR_STAFF_ROLE_ID = '1543367669385011302';
const GENERAL_STAFF_ROLE_ID = '1543373922668388482';

// =====================================================
// OWNER / CO-OWNER REQUEST SYSTEM
// =====================================================

// Owner / Co-Owner requests reports here
const REQUEST_REPORT_CHANNEL_ID = '1549136946683576380';

// Private requested-report channels are created here
const REQUESTED_REPORTS_CATEGORY_ID = '1549140124854653038';

// Finished requested reports go here
const SUBMITTED_REQUESTED_REPORTS_CHANNEL_ID = '1549140613788864563';

// =====================================================
// GENERAL STAFF REPORT SYSTEM
// =====================================================

// General Staff makes reports here
const GENERAL_REPORTS_TO_MAKE_CHANNEL_ID = '1549141254653349920';

// General Staff reports are reviewed by Senior Staff here
const GENERAL_REPORTS_REVIEW_CHANNEL_ID = '1549149758202052818';

// =====================================================
// SENIOR STAFF REPORT SYSTEM
// =====================================================

// Senior Staff makes reports here
const SENIOR_REPORTS_TO_MAKE_CHANNEL_ID = '1549148764760055838';

// Senior Staff reports go here for Owner / Co-Owner
const SENIOR_REPORTS_DESTINATION_CHANNEL_ID = '1549141094388863126';

// =====================================================
// ENVIRONMENT VARIABLES
// =====================================================

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || null;
const CO_OWNER_ROLE_ID = process.env.CO_OWNER_ROLE_ID || null;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN.');
  process.exit(1);
}

// =====================================================
// DATA
// =====================================================

const DATA_FILE = path.join(
  __dirname,
  'staff-reports-data.json'
);

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        requests: {},
      };
    }

    const parsed = JSON.parse(
      fs.readFileSync(
        DATA_FILE,
        'utf8'
      )
    );

    return {
      requests: parsed.requests || {},
    };
  } catch (error) {
    console.error(
      '⚠️ Could not load data:',
      error
    );

    return {
      requests: {},
    };
  }
}

let data = loadData();

function saveData() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        data,
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      '⚠️ Could not save data:',
      error
    );
  }
}

// Temporary Owner / Co-Owner request sessions
const requestDrafts = new Map();

// =====================================================
// MEMBER CACHE CONTROL
// =====================================================

let membersLoaded = false;
let memberLoadPromise = null;
let lastMemberLoadAttempt = 0;

async function ensureMembersLoaded(guild) {
  if (membersLoaded) {
    return true;
  }

  if (memberLoadPromise) {
    return memberLoadPromise;
  }

  if (
    Date.now() - lastMemberLoadAttempt <
    60000
  ) {
    return false;
  }

  lastMemberLoadAttempt = Date.now();

  memberLoadPromise = (async () => {
    try {
      console.log(
        '🔄 Loading server members...'
      );

      await guild.members.fetch();

      membersLoaded = true;

      console.log(
        `✅ Loaded ${guild.members.cache.size} members.`
      );

      return true;
    } catch (error) {
      console.error(
        '❌ Could not load server members:',
        error
      );

      console.error(
        'Make sure SERVER MEMBERS INTENT is enabled.'
      );

      return false;
    } finally {
      memberLoadPromise = null;
    }
  })();

  return memberLoadPromise;
}

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
// PERMISSION HELPERS
// =====================================================

function canRequestReports(
  member,
  guild
) {
  if (!member) {
    return false;
  }

  if (
    member.id ===
    guild.ownerId
  ) {
    return true;
  }

  if (
    member.permissions.has(
      PermissionsBitField
        .Flags.Administrator
    )
  ) {
    return true;
  }

  if (
    OWNER_ROLE_ID &&
    member.roles.cache.has(
      OWNER_ROLE_ID
    )
  ) {
    return true;
  }

  if (
    CO_OWNER_ROLE_ID &&
    member.roles.cache.has(
      CO_OWNER_ROLE_ID
    )
  ) {
    return true;
  }

  return false;
}

function isSeniorStaff(member) {
  return (
    member &&
    member.roles.cache.has(
      SENIOR_STAFF_ROLE_ID
    )
  );
}

function isGeneralStaff(member) {
  return (
    member &&
    member.roles.cache.has(
      GENERAL_STAFF_ROLE_ID
    )
  );
}

function isStaff(member) {
  return (
    isSeniorStaff(member) ||
    isGeneralStaff(member)
  );
}

// =====================================================
// BASIC HELPERS
// =====================================================

async function getChannel(
  guild,
  channelId
) {
  return (
    guild.channels.cache.get(
      channelId
    ) ||
    await guild.channels
      .fetch(channelId)
      .catch(() => null)
  );
}

async function getMember(
  guild,
  userId
) {
  return (
    guild.members.cache.get(
      userId
    ) ||
    await guild.members
      .fetch(userId)
      .catch(() => null)
  );
}

function createRequestId() {
  return (
    Date.now().toString() +
    '-' +
    Math.floor(
      Math.random() *
      100000
    )
  );
}

function sanitizeChannelName(
  name
) {
  return (
    name
      .toLowerCase()
      .replace(
        /[^a-z0-9-]/g,
        '-'
      )
      .replace(
        /-+/g,
        '-'
      )
      .replace(
        /^-|-$/g,
        ''
      )
      .slice(
        0,
        80
      ) ||
    'staff-report'
  );
}

function discordTimestamp(ms) {
  const unix =
    Math.floor(
      ms / 1000
    );

  return (
    `<t:${unix}:F> • ` +
    `<t:${unix}:R>`
  );
}

function parseHours(value) {
  const number =
    Number(
      String(value).trim()
    );

  if (
    !Number.isFinite(number)
  ) {
    return null;
  }

  return number;
}

// =====================================================
// ROLE-FILTERED STAFF OPTIONS
// =====================================================

function getRoleOptions(
  guild,
  roleId
) {
  const role =
    guild.roles.cache.get(
      roleId
    );

  if (!role) {
    return [];
  }

  return [
    ...role.members.values(),
  ]
    .filter(
      member =>
        !member.user.bot
    )
    .slice(0, 25)
    .map(
      member => ({
        label:
          member.displayName
            .slice(0, 100),

        description:
          member.user.username
            .slice(0, 100),

        value:
          member.id,
      })
    );
}

function getCombinedStaffOptions(
  guild
) {
  const unique =
    new Map();

  const seniorRole =
    guild.roles.cache.get(
      SENIOR_STAFF_ROLE_ID
    );

  const generalRole =
    guild.roles.cache.get(
      GENERAL_STAFF_ROLE_ID
    );

  if (seniorRole) {
    for (
      const member
      of seniorRole.members.values()
    ) {
      if (
        !member.user.bot
      ) {
        unique.set(
          member.id,
          member
        );
      }
    }
  }

  if (generalRole) {
    for (
      const member
      of generalRole.members.values()
    ) {
      if (
        !member.user.bot
      ) {
        unique.set(
          member.id,
          member
        );
      }
    }
  }

  return [
    ...unique.values(),
  ]
    .slice(0, 25)
    .map(
      member => {
        const groups = [];

        if (
          member.roles.cache.has(
            SENIOR_STAFF_ROLE_ID
          )
        ) {
          groups.push(
            'Senior Staff'
          );
        }

        if (
          member.roles.cache.has(
            GENERAL_STAFF_ROLE_ID
          )
        ) {
          groups.push(
            'General Staff'
          );
        }

        return {
          label:
            member.displayName
              .slice(
                0,
                100
              ),

          description:
            groups
              .join(' + ')
              .slice(
                0,
                100
              ),

          value:
            member.id,
        };
      }
    );
}

// =====================================================
// GET TARGET MEMBERS
// =====================================================

async function getTargets(
  guild,
  draft
) {
  if (
    draft.targetMode ===
    'one_senior'
  ) {
    const member =
      await getMember(
        guild,
        draft.targetUserIds[0]
      );

    if (
      member &&
      isSeniorStaff(member)
    ) {
      return [member];
    }

    return [];
  }

  if (
    draft.targetMode ===
    'one_general'
  ) {
    const member =
      await getMember(
        guild,
        draft.targetUserIds[0]
      );

    if (
      member &&
      isGeneralStaff(member)
    ) {
      return [member];
    }

    return [];
  }

  if (
    draft.targetMode ===
    'selected_staff'
  ) {
    const members = [];

    for (
      const userId
      of draft.targetUserIds
    ) {
      const member =
        await getMember(
          guild,
          userId
        );

      if (
        member &&
        isStaff(member) &&
        !member.user.bot
      ) {
        members.push(
          member
        );
      }
    }

    return members;
  }

  if (
    draft.targetMode ===
    'all_senior'
  ) {
    const role =
      guild.roles.cache.get(
        SENIOR_STAFF_ROLE_ID
      );

    if (!role) {
      return [];
    }

    return [
      ...role.members.values(),
    ].filter(
      member =>
        !member.user.bot
    );
  }

  if (
    draft.targetMode ===
    'all_general'
  ) {
    const role =
      guild.roles.cache.get(
        GENERAL_STAFF_ROLE_ID
      );

    if (!role) {
      return [];
    }

    return [
      ...role.members.values(),
    ].filter(
      member =>
        !member.user.bot
    );
  }

  if (
    draft.targetMode ===
    'both_groups'
  ) {
    const unique =
      new Map();

    const seniorRole =
      guild.roles.cache.get(
        SENIOR_STAFF_ROLE_ID
      );

    const generalRole =
      guild.roles.cache.get(
        GENERAL_STAFF_ROLE_ID
      );

    if (seniorRole) {
      for (
        const member
        of seniorRole.members.values()
      ) {
        if (
          !member.user.bot
        ) {
          unique.set(
            member.id,
            member
          );
        }
      }
    }

    if (generalRole) {
      for (
        const member
        of generalRole.members.values()
      ) {
        if (
          !member.user.bot
        ) {
          unique.set(
            member.id,
            member
          );
        }
      }
    }

    return [
      ...unique.values(),
    ];
  }

  return [];
}

// =====================================================
// OWNER / CO-OWNER PANEL
// =====================================================

async function createOwnerPanel(
  guild
) {
  const channel =
    await getChannel(
      guild,
      REQUEST_REPORT_CHANNEL_ID
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    console.error(
      '❌ Request report channel not found.'
    );

    return;
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 50,
      })
      .catch(
        () => null
      );

  const existing =
    messages?.find(
      message =>
        message.author.id ===
          client.user.id &&
        message.components.some(
          row =>
            row.components.some(
              component =>
                component.customId ===
                'request_staff_report'
            )
        )
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        '📋 Staff Report Requests'
      )
      .setDescription(
        [
          'Owner and Co-Owner can request reports here.',
          '',
          '👤 One Senior Staff Member',
          '👤 One General Staff Member',
          '🎯 Certain Selected Staff Members',
          '👥 All Senior Staff',
          '👥 All General Staff',
          '📣 Both Staff Groups',
          '',
          '**Certain Selected Staff Members** only shows people with the Senior Staff or General Staff role.',
          '',
          '**Minimum deadline: 24 hours.**',
          '',
          'Deadlines automatically display in each person’s timezone.',
        ].join(
          '\n'
        )
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'request_staff_report'
          )
          .setLabel(
            'Request a Report'
          )
          .setEmoji('📝')
          .setStyle(
            ButtonStyle.Primary
          )
      );

  if (existing) {
    await existing.edit({
      embeds:
        [embed],

      components:
        [row],
    });
  } else {
    await channel.send({
      embeds:
        [embed],

      components:
        [row],
    });
  }
}

// =====================================================
// GENERAL STAFF PANEL
// =====================================================

async function createGeneralStaffPanel(
  guild
) {
  const channel =
    await getChannel(
      guild,
      GENERAL_REPORTS_TO_MAKE_CHANNEL_ID
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    console.error(
      '❌ General Staff reports channel not found.'
    );

    return;
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 50,
      })
      .catch(
        () => null
      );

  const existing =
    messages?.find(
      message =>
        message.author.id ===
          client.user.id &&
        message.components.some(
          row =>
            row.components.some(
              component =>
                component.customId ===
                'create_general_report'
            )
        )
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        '📄 General Staff Reports'
      )
      .setDescription(
        [
          'This panel is for **General Staff**.',
          '',
          'Submit reports here for **Senior Staff to review**.',
        ].join(
          '\n'
        )
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'create_general_report'
          )
          .setLabel(
            'Create General Staff Report'
          )
          .setEmoji('📄')
          .setStyle(
            ButtonStyle.Primary
          )
      );

  if (existing) {
    await existing.edit({
      embeds:
        [embed],

      components:
        [row],
    });
  } else {
    await channel.send({
      embeds:
        [embed],

      components:
        [row],
    });
  }
}

// =====================================================
// SENIOR STAFF PANEL
// =====================================================

async function createSeniorStaffPanel(
  guild
) {
  const channel =
    await getChannel(
      guild,
      SENIOR_REPORTS_TO_MAKE_CHANNEL_ID
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    console.error(
      '❌ Senior Staff reports channel not found.'
    );

    return;
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 50,
      })
      .catch(
        () => null
      );

  const existing =
    messages?.find(
      message =>
        message.author.id ===
          client.user.id &&
        message.components.some(
          row =>
            row.components.some(
              component =>
                component.customId ===
                'create_senior_report'
            )
        )
    );

  const embed =
    new EmbedBuilder()
      .setTitle(
        '📋 Senior Staff Reports'
      )
      .setDescription(
        [
          'This panel is for **Senior Staff**.',
          '',
          'Reports submitted here are sent directly to the **Owner and Co-Owner**.',
        ].join(
          '\n'
        )
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            'create_senior_report'
          )
          .setLabel(
            'Create Senior Staff Report'
          )
          .setEmoji('📋')
          .setStyle(
            ButtonStyle.Success
          )
      );

  if (existing) {
    await existing.edit({
      embeds:
        [embed],

      components:
        [row],
    });
  } else {
    await channel.send({
      embeds:
        [embed],

      components:
        [row],
    });
  }
}

// =====================================================
// REQUEST MODAL
// =====================================================

function createRequestModal() {
  const modal =
    new ModalBuilder()
      .setCustomId(
        'report_request_details'
      )
      .setTitle(
        'Request Staff Report'
      );

  const report =
    new TextInputBuilder()
      .setCustomId(
        'report_question'
      )
      .setLabel(
        'What report do you need?'
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(true)
      .setMaxLength(1500)
      .setPlaceholder(
        'Explain what information you need.'
      );

  const deadline =
    new TextInputBuilder()
      .setCustomId(
        'report_deadline'
      )
      .setLabel(
        'Hours until due — minimum 24'
      )
      .setStyle(
        TextInputStyle.Short
      )
      .setRequired(true)
      .setMaxLength(10)
      .setPlaceholder(
        'Example: 24, 48, 72'
      );

  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(
        report
      ),

    new ActionRowBuilder()
      .addComponents(
        deadline
      )
  );

  return modal;
}

// =====================================================
// CREATE PRIVATE REQUEST CHANNEL
// =====================================================

async function createPrivateRequestedReport({
  guild,
  targetMember,
  requesterId,
  reportQuestion,
  hoursUntilDue,
}) {
  const requestId =
    createRequestId();

  const createdAt =
    Date.now();

  const dueAt =
    createdAt +
    hoursUntilDue *
      60 *
      60 *
      1000;

  const permissionOverwrites = [
    {
      id:
        guild.roles.everyone.id,

      deny: [
        PermissionsBitField
          .Flags.ViewChannel,
      ],
    },

    // Assigned staff member can SEE the report,
    // but cannot type normal messages.
    {
      id:
        targetMember.id,

      allow: [
        PermissionsBitField
          .Flags.ViewChannel,

        PermissionsBitField
          .Flags.ReadMessageHistory,
      ],

      deny: [
        PermissionsBitField
          .Flags.SendMessages,

        PermissionsBitField
          .Flags.SendMessagesInThreads,

        PermissionsBitField
          .Flags.CreatePublicThreads,

        PermissionsBitField
          .Flags.CreatePrivateThreads,
      ],
    },

    // Server owner can view/manage the report channel.
    {
      id:
        guild.ownerId,

      allow: [
        PermissionsBitField
          .Flags.ViewChannel,

        PermissionsBitField
          .Flags.SendMessages,

        PermissionsBitField
          .Flags.ReadMessageHistory,

        PermissionsBitField
          .Flags.ManageChannels,
      ],
    },
  ];

  if (OWNER_ROLE_ID) {
    permissionOverwrites.push({
      id:
        OWNER_ROLE_ID,

      allow: [
        PermissionsBitField
          .Flags.ViewChannel,

        PermissionsBitField
          .Flags.SendMessages,

        PermissionsBitField
          .Flags.ReadMessageHistory,
      ],
    });
  }

  if (CO_OWNER_ROLE_ID) {
    permissionOverwrites.push({
      id:
        CO_OWNER_ROLE_ID,

      allow: [
        PermissionsBitField
          .Flags.ViewChannel,

        PermissionsBitField
          .Flags.SendMessages,

        PermissionsBitField
          .Flags.ReadMessageHistory,
      ],
    });
  }

  const channel =
    await guild.channels.create({
      name:
        sanitizeChannelName(
          `report-${targetMember.user.username}-${requestId.slice(-4)}`
        ),

      type:
        ChannelType.GuildText,

      parent:
        REQUESTED_REPORTS_CATEGORY_ID,

      permissionOverwrites,
    });

  data.requests[
    requestId
  ] = {
    requestId,

    channelId:
      channel.id,

    targetUserId:
      targetMember.id,

    requesterId,

    reportQuestion,

    createdAt,

    dueAt,

    status:
      'open',
  };

  saveData();

  const embed =
    new EmbedBuilder()
      .setTitle(
        '📋 Staff Report Requested'
      )
      .setDescription(
        [
          `${targetMember}, you have been requested to complete a report.`,
          '',
          `**Requested By:** <@${requesterId}>`,
          '',
          '**Report Needed:**',
          reportQuestion,
          '',
          `**Deadline:** ${discordTimestamp(
            dueAt
          )}`,
          '',
          'This channel is **read-only**.',
          '',
          'Click **Submit Report** below to complete the report.',
        ].join(
          '\n'
        )
      );

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `submit_requested_report:${requestId}`
          )
          .setLabel(
            'Submit Report'
          )
          .setEmoji('✅')
          .setStyle(
            ButtonStyle.Success
          )
      );

  await channel.send({
    content:
      `<@${targetMember.id}>`,

    embeds:
      [embed],

    components:
      [row],
  });
}

// =====================================================
// READY
// =====================================================

client.once(
  Events.ClientReady,

  async () => {
    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    const guild =
      client.guilds.cache.get(
        GUILD_ID
      ) ||
      await client.guilds
        .fetch(GUILD_ID)
        .catch(
          () => null
        );

    if (!guild) {
      console.error(
        '❌ Server not found.'
      );

      return;
    }

    await ensureMembersLoaded(
      guild
    );

    await createOwnerPanel(
      guild
    );

    await createGeneralStaffPanel(
      guild
    );

    await createSeniorStaffPanel(
      guild
    );

    console.log(
      '✅ Staff Reports panels are ready.'
    );
  }
);

// =====================================================
// INTERACTIONS
// =====================================================

client.on(
  Events.InteractionCreate,

  async interaction => {
    try {
      if (
        !interaction.guild ||
        interaction.guild.id !==
          GUILD_ID
      ) {
        return;
      }

      // =================================================
      // REQUEST REPORT BUTTON
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'request_staff_report'
      ) {
        const member =
          await getMember(
            interaction.guild,
            interaction.user.id
          );

        if (
          !canRequestReports(
            member,
            interaction.guild
          )
        ) {
          return interaction.reply({
            content:
              '❌ Only the Owner or Co-Owner can request reports.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const loaded =
          await ensureMembersLoaded(
            interaction.guild
          );

        if (!loaded) {
          return interaction.reply({
            content:
              '❌ I could not load the staff list. Make sure Server Members Intent is enabled, then restart the bot.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        requestDrafts.set(
          interaction.user.id,
          {
            requesterId:
              interaction.user.id,

            targetMode:
              null,

            targetUserIds:
              [],
          }
        );

        const menu =
          new StringSelectMenuBuilder()
            .setCustomId(
              'choose_report_target'
            )
            .setPlaceholder(
              'Choose who needs to make the report'
            )
            .addOptions([
              {
                label:
                  'One Senior Staff Member',

                value:
                  'one_senior',

                emoji:
                  '👤',
              },

              {
                label:
                  'One General Staff Member',

                value:
                  'one_general',

                emoji:
                  '👤',
              },

              {
                label:
                  'Certain Selected Staff Members',

                description:
                  'Choose specific staff members',

                value:
                  'selected_staff',

                emoji:
                  '🎯',
              },

              {
                label:
                  'All Senior Staff',

                value:
                  'all_senior',

                emoji:
                  '👥',
              },

              {
                label:
                  'All General Staff',

                value:
                  'all_general',

                emoji:
                  '👥',
              },

              {
                label:
                  'Both Staff Groups',

                value:
                  'both_groups',

                emoji:
                  '📣',
              },
            ]);

        return interaction.reply({
          content:
            '**Step 1:** Choose who needs to make the report.',

          components: [
            new ActionRowBuilder()
              .addComponents(
                menu
              ),
          ],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // =================================================
      // CHOOSE REPORT TARGET TYPE
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'choose_report_target'
      ) {
        const draft =
          requestDrafts.get(
            interaction.user.id
          );

        if (!draft) {
          return interaction.reply({
            content:
              '❌ Request expired. Start again.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const mode =
          interaction.values[0];

        draft.targetMode =
          mode;

        draft.targetUserIds =
          [];

        requestDrafts.set(
          interaction.user.id,
          draft
        );

        if (
          mode ===
          'one_senior'
        ) {
          const options =
            getRoleOptions(
              interaction.guild,
              SENIOR_STAFF_ROLE_ID
            );

          if (
            options.length ===
            0
          ) {
            return interaction.update({
              content:
                '❌ No Senior Staff members were found.',

              components:
                [],
            });
          }

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                'select_one_senior'
              )
              .setPlaceholder(
                'Select one Senior Staff member'
              )
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                options
              );

          return interaction.update({
            content:
              '**Step 2:** Select one Senior Staff member.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  menu
                ),
            ],
          });
        }

        if (
          mode ===
          'one_general'
        ) {
          const options =
            getRoleOptions(
              interaction.guild,
              GENERAL_STAFF_ROLE_ID
            );

          if (
            options.length ===
            0
          ) {
            return interaction.update({
              content:
                '❌ No General Staff members were found.',

              components:
                [],
            });
          }

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                'select_one_general'
              )
              .setPlaceholder(
                'Select one General Staff member'
              )
              .setMinValues(1)
              .setMaxValues(1)
              .addOptions(
                options
              );

          return interaction.update({
            content:
              '**Step 2:** Select one General Staff member.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  menu
                ),
            ],
          });
        }

        if (
          mode ===
          'selected_staff'
        ) {
          const options =
            getCombinedStaffOptions(
              interaction.guild
            );

          if (
            options.length ===
            0
          ) {
            return interaction.update({
              content:
                '❌ No Senior Staff or General Staff members were found.',

              components:
                [],
            });
          }

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                'select_multiple_staff'
              )
              .setPlaceholder(
                'Select the staff members'
              )
              .setMinValues(1)
              .setMaxValues(
                Math.min(
                  options.length,
                  25
                )
              )
              .addOptions(
                options
              );

          return interaction.update({
            content:
              '**Step 2:** Select the specific Senior Staff and/or General Staff members.',

            components: [
              new ActionRowBuilder()
                .addComponents(
                  menu
                ),
            ],
          });
        }

        return interaction.showModal(
          createRequestModal()
        );
      }

      // =================================================
      // ONE SENIOR SELECTED
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'select_one_senior'
      ) {
        const draft =
          requestDrafts.get(
            interaction.user.id
          );

        if (!draft) {
          return interaction.reply({
            content:
              '❌ Request expired.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        draft.targetUserIds =
          [
            interaction.values[0],
          ];

        requestDrafts.set(
          interaction.user.id,
          draft
        );

        return interaction.showModal(
          createRequestModal()
        );
      }

      // =================================================
      // ONE GENERAL SELECTED
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'select_one_general'
      ) {
        const draft =
          requestDrafts.get(
            interaction.user.id
          );

        if (!draft) {
          return interaction.reply({
            content:
              '❌ Request expired.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        draft.targetUserIds =
          [
            interaction.values[0],
          ];

        requestDrafts.set(
          interaction.user.id,
          draft
        );

        return interaction.showModal(
          createRequestModal()
        );
      }

      // =================================================
      // MULTIPLE STAFF SELECTED
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'select_multiple_staff'
      ) {
        const draft =
          requestDrafts.get(
            interaction.user.id
          );

        if (!draft) {
          return interaction.reply({
            content:
              '❌ Request expired.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        draft.targetUserIds =
          interaction.values;

        requestDrafts.set(
          interaction.user.id,
          draft
        );

        return interaction.showModal(
          createRequestModal()
        );
      }

      // =================================================
      // REQUEST DETAILS
      // =================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          'report_request_details'
      ) {
        const draft =
          requestDrafts.get(
            interaction.user.id
          );

        if (!draft) {
          return interaction.reply({
            content:
              '❌ Request expired.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const reportQuestion =
          interaction.fields
            .getTextInputValue(
              'report_question'
            )
            .trim();

        const hours =
          parseHours(
            interaction.fields
              .getTextInputValue(
                'report_deadline'
              )
          );

        if (
          hours === null ||
          hours < 24
        ) {
          return interaction.reply({
            content:
              '❌ The deadline must be at least **24 hours**.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        draft.reportQuestion =
          reportQuestion;

        draft.hoursUntilDue =
          hours;

        requestDrafts.set(
          interaction.user.id,
          draft
        );

        const targets =
          await getTargets(
            interaction.guild,
            draft
          );

        if (
          targets.length ===
          0
        ) {
          return interaction.reply({
            content:
              '❌ No valid staff members were found.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const dueAt =
          Date.now() +
          hours *
            60 *
            60 *
            1000;

        const people =
          targets
            .map(
              member =>
                `<@${member.id}>`
            )
            .join(', ');

        const embed =
          new EmbedBuilder()
            .setTitle(
              '✅ Confirm Report Request'
            )
            .setDescription(
              [
                `**Who:** ${people}`,
                '',
                '**Report Needed:**',
                reportQuestion,
                '',
                `**Deadline:** ${discordTimestamp(
                  dueAt
                )}`,
                '',
                `**People Receiving Request:** ${targets.length}`,
              ].join(
                '\n'
              )
            );

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  'confirm_report_request'
                )
                .setLabel(
                  'Confirm Request'
                )
                .setEmoji('✅')
                .setStyle(
                  ButtonStyle.Success
                ),

              new ButtonBuilder()
                .setCustomId(
                  'cancel_report_request'
                )
                .setLabel(
                  'Cancel'
                )
                .setEmoji('❌')
                .setStyle(
                  ButtonStyle.Danger
                )
            );

        return interaction.reply({
          embeds:
            [embed],

          components:
            [row],

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // =================================================
      // CONFIRM REQUEST
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'confirm_report_request'
      ) {
        const draft =
          requestDrafts.get(
            interaction.user.id
          );

        if (!draft) {
          return interaction.reply({
            content:
              '❌ Request expired.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        await interaction.deferUpdate();

        const targets =
          await getTargets(
            interaction.guild,
            draft
          );

        let created =
          0;

        let failed =
          0;

        for (
          const target
          of targets
        ) {
          try {
            await createPrivateRequestedReport({
              guild:
                interaction.guild,

              targetMember:
                target,

              requesterId:
                interaction.user.id,

              reportQuestion:
                draft.reportQuestion,

              hoursUntilDue:
                draft.hoursUntilDue,
            });

            created++;
          } catch (error) {
            failed++;

            console.error(
              '❌ Failed to create report:',
              error
            );
          }
        }

        requestDrafts.delete(
          interaction.user.id
        );

        return interaction.editReply({
          content:
            [
              `✅ Created **${created}** report request(s).`,

              failed > 0
                ? `⚠️ ${failed} failed.`
                : null,
            ]
              .filter(Boolean)
              .join('\n'),

          embeds:
            [],

          components:
            [],
        });
      }

      // =================================================
      // CANCEL REQUEST
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'cancel_report_request'
      ) {
        requestDrafts.delete(
          interaction.user.id
        );

        return interaction.update({
          content:
            '❌ Report request cancelled.',

          embeds:
            [],

          components:
            [],
        });
      }

      // =================================================
      // REQUESTED REPORT SUBMIT BUTTON
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          'submit_requested_report:'
        )
      ) {
        const requestId =
          interaction.customId.split(
            ':'
          )[1];

        const request =
          data.requests[
            requestId
          ];

        if (
          !request ||
          request.status !==
            'open'
        ) {
          return interaction.reply({
            content:
              '❌ This report is no longer open.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        if (
          interaction.user.id !==
          request.targetUserId
        ) {
          return interaction.reply({
            content:
              '❌ This report is assigned to someone else. Only the assigned staff member can submit it.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              `requested_report_submission:${requestId}`
            )
            .setTitle(
              'Submit Requested Report'
            );

        const body =
          new TextInputBuilder()
            .setCustomId(
              'requested_report_body'
            )
            .setLabel(
              'Completed Report'
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMaxLength(4000)
            .setPlaceholder(
              'Type your full report here.'
            );

        const next =
          new TextInputBuilder()
            .setCustomId(
              'next_report_time'
            )
            .setLabel(
              'When should another report be made?'
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
            .setMaxLength(100)
            .setPlaceholder(
              'Example: weekly, 7 days, none'
            );

        modal.addComponents(
          new ActionRowBuilder()
            .addComponents(
              body
            ),

          new ActionRowBuilder()
            .addComponents(
              next
            )
        );

        return interaction.showModal(
          modal
        );
      }

      // =================================================
      // REQUESTED REPORT SUBMISSION
      // =================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          'requested_report_submission:'
        )
      ) {
        const requestId =
          interaction.customId.split(
            ':'
          )[1];

        const request =
          data.requests[
            requestId
          ];

        if (
          !request ||
          request.status !==
            'open'
        ) {
          return interaction.reply({
            content:
              '❌ This report is no longer open.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        if (
          interaction.user.id !==
          request.targetUserId
        ) {
          return interaction.reply({
            content:
              '❌ You are not assigned to this report.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const body =
          interaction.fields
            .getTextInputValue(
              'requested_report_body'
            )
            .trim();

        const next =
          interaction.fields
            .getTextInputValue(
              'next_report_time'
            )
            .trim();

        const destination =
          await getChannel(
            interaction.guild,
            SUBMITTED_REQUESTED_REPORTS_CHANNEL_ID
          );

        if (
          !destination ||
          !destination.isTextBased()
        ) {
          return interaction.reply({
            content:
              '❌ Submitted reports channel could not be found.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              '📥 Submitted Requested Report'
            )
            .setDescription(
              body
            )
            .addFields(
              {
                name:
                  'Submitted By',

                value:
                  `<@${interaction.user.id}>`,
              },

              {
                name:
                  'Requested By',

                value:
                  `<@${request.requesterId}>`,
              },

              {
                name:
                  'Original Request',

                value:
                  request.reportQuestion,
              },

              {
                name:
                  'Next Report',

                value:
                  next,
              }
            )
            .setTimestamp();

        await destination.send({
          content:
            `<@${request.requesterId}>`,

          embeds:
            [embed],
        });

        request.status =
          'submitted';

        request.submittedAt =
          Date.now();

        request.nextReport =
          next;

        saveData();

        await interaction.reply({
          content:
            '✅ Your report was submitted successfully.',

          flags:
            MessageFlags.Ephemeral,
        });

        const channel =
          interaction.channel;

        setTimeout(
          async () => {
            if (
              channel &&
              channel.deletable
            ) {
              await channel
                .delete(
                  'Report submitted'
                )
                .catch(
                  console.error
                );
            }
          },

          3000
        );

        return;
      }

      // =================================================
      // GENERAL STAFF REPORT BUTTON
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'create_general_report'
      ) {
        const member =
          await getMember(
            interaction.guild,
            interaction.user.id
          );

        if (
          !isGeneralStaff(member)
        ) {
          return interaction.reply({
            content:
              '❌ This panel is for General Staff only.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              'general_report_submission'
            )
            .setTitle(
              'General Staff Report'
            );

        const title =
          new TextInputBuilder()
            .setCustomId(
              'general_report_title'
            )
            .setLabel(
              'Report Title'
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
            .setMaxLength(150);

        const body =
          new TextInputBuilder()
            .setCustomId(
              'general_report_body'
            )
            .setLabel(
              'Report'
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMaxLength(4000);

        modal.addComponents(
          new ActionRowBuilder()
            .addComponents(
              title
            ),

          new ActionRowBuilder()
            .addComponents(
              body
            )
        );

        return interaction.showModal(
          modal
        );
      }

      // =================================================
      // GENERAL STAFF REPORT SUBMITTED
      // =================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          'general_report_submission'
      ) {
        const member =
          await getMember(
            interaction.guild,
            interaction.user.id
          );

        if (
          !isGeneralStaff(member)
        ) {
          return interaction.reply({
            content:
              '❌ General Staff only.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const title =
          interaction.fields
            .getTextInputValue(
              'general_report_title'
            )
            .trim();

        const body =
          interaction.fields
            .getTextInputValue(
              'general_report_body'
            )
            .trim();

        const destination =
          await getChannel(
            interaction.guild,
            GENERAL_REPORTS_REVIEW_CHANNEL_ID
          );

        if (
          !destination ||
          !destination.isTextBased()
        ) {
          return interaction.reply({
            content:
              '❌ Senior Staff review channel could not be found.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              `📄 General Staff Report — ${title}`
            )
            .setDescription(
              body
            )
            .addFields(
              {
                name:
                  'Submitted By',

                value:
                  `<@${interaction.user.id}>`,
              },

              {
                name:
                  'Review Status',

                value:
                  '⏳ Waiting for Senior Staff Review',
              }
            )
            .setTimestamp();

        await destination.send({
          content:
            `<@&${SENIOR_STAFF_ROLE_ID}>`,

          embeds:
            [embed],

          allowedMentions: {
            roles: [
              SENIOR_STAFF_ROLE_ID,
            ],
          },
        });

        return interaction.reply({
          content:
            '✅ Report sent to Senior Staff for review.',

          flags:
            MessageFlags.Ephemeral,
        });
      }

      // =================================================
      // SENIOR STAFF REPORT BUTTON
      // =================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          'create_senior_report'
      ) {
        const member =
          await getMember(
            interaction.guild,
            interaction.user.id
          );

        if (
          !isSeniorStaff(member)
        ) {
          return interaction.reply({
            content:
              '❌ This panel is for Senior Staff only.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              'senior_report_submission'
            )
            .setTitle(
              'Senior Staff Report'
            );

        const title =
          new TextInputBuilder()
            .setCustomId(
              'senior_report_title'
            )
            .setLabel(
              'Report Title'
            )
            .setStyle(
              TextInputStyle.Short
            )
            .setRequired(true)
            .setMaxLength(150);

        const body =
          new TextInputBuilder()
            .setCustomId(
              'senior_report_body'
            )
            .setLabel(
              'Report'
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMaxLength(4000);

        modal.addComponents(
          new ActionRowBuilder()
            .addComponents(
              title
            ),

          new ActionRowBuilder()
            .addComponents(
              body
            )
        );

        return interaction.showModal(
          modal
        );
      }

      // =================================================
      // SENIOR STAFF REPORT SUBMITTED
      // =================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          'senior_report_submission'
      ) {
        const member =
          await getMember(
            interaction.guild,
            interaction.user.id
          );

        if (
          !isSeniorStaff(member)
        ) {
          return interaction.reply({
            content:
              '❌ Senior Staff only.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const title =
          interaction.fields
            .getTextInputValue(
              'senior_report_title'
            )
            .trim();

        const body =
          interaction.fields
            .getTextInputValue(
              'senior_report_body'
            )
            .trim();

        const destination =
          await getChannel(
            interaction.guild,
            SENIOR_REPORTS_DESTINATION_CHANNEL_ID
          );

        if (
          !destination ||
          !destination.isTextBased()
        ) {
          return interaction.reply({
            content:
              '❌ Owner / Co-Owner report channel could not be found.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              `📋 Senior Staff Report — ${title}`
            )
            .setDescription(
              body
            )
            .addFields(
              {
                name:
                  'Submitted By',

                value:
                  `<@${interaction.user.id}>`,
              },

              {
                name:
                  'For',

                value:
                  'Owner / Co-Owner',
              }
            )
            .setTimestamp();

        const pings = [];

        if (
          OWNER_ROLE_ID
        ) {
          pings.push(
            `<@&${OWNER_ROLE_ID}>`
          );
        }

        if (
          CO_OWNER_ROLE_ID
        ) {
          pings.push(
            `<@&${CO_OWNER_ROLE_ID}>`
          );
        }

        await destination.send({
          content:
            pings.length
              ? pings.join(' ')
              : undefined,

          embeds:
            [embed],

          allowedMentions: {
            roles: [
              OWNER_ROLE_ID,
              CO_OWNER_ROLE_ID,
            ].filter(
              Boolean
            ),
          },
        });

        return interaction.reply({
          content:
            '✅ Report sent to Owner / Co-Owner.',

          flags:
            MessageFlags.Ephemeral,
        });
      }

    } catch (error) {
      console.error(
        '❌ Interaction error:',
        error
      );

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        await interaction
          .followUp({
            content:
              '❌ Something went wrong. Check the bot logs.',

            flags:
              MessageFlags.Ephemeral,
          })
          .catch(
            () => {}
          );
      } else {
        await interaction
          .reply({
            content:
              '❌ Something went wrong. Check the bot logs.',

            flags:
              MessageFlags.Ephemeral,
          })
          .catch(
            () => {}
          );
      }
    }
  }
);

// =====================================================
// LOGIN
// =====================================================

client.login(DISCORD_TOKEN);
