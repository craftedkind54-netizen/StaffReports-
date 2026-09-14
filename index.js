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
// CONFIG
// =====================================================

const GUILD_ID = '1543363950262100118';

// Owner / Co-Owner report request channel
const REQUEST_REPORT_CHANNEL_ID = '1549136946683576380';

// Roles
const SENIOR_STAFF_ROLE_ID = '1543367669385011302';
const GENERAL_STAFF_ROLE_ID = '1543373922668388482';

// Requested report system
const REQUESTED_REPORTS_CATEGORY_ID = '1549140124854653038';
const SUBMITTED_REQUESTED_REPORTS_CHANNEL_ID = '1549140613788864563';

// General Staff reports
const GENERAL_REPORTS_TO_MAKE_CHANNEL_ID = '1549141254653349920';
const GENERAL_REPORTS_REVIEW_CHANNEL_ID = '1549149758202052818';

// Senior Staff reports
const SENIOR_REPORTS_TO_MAKE_CHANNEL_ID = '1549148764760055838';
const SENIOR_REPORTS_DESTINATION_CHANNEL_ID = '1549141094388863126';

// Environment variables
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID || null;
const CO_OWNER_ROLE_ID = process.env.CO_OWNER_ROLE_ID || null;

if (!DISCORD_TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN');
  process.exit(1);
}

// =====================================================
// DATA
// =====================================================

const DATA_FILE = path.join(__dirname, 'staff-reports-data.json');

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return {
        requests: {},
      };
    }

    const parsed = JSON.parse(
      fs.readFileSync(DATA_FILE, 'utf8')
    );

    return {
      requests: parsed.requests || {},
    };
  } catch (error) {
    console.error('⚠️ Could not load data:', error);

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
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error('⚠️ Could not save data:', error);
  }
}

const requestDrafts = new Map();

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
// PERMISSIONS
// =====================================================

function canRequestReports(member, guild) {
  if (!member) return false;

  if (member.id === guild.ownerId) {
    return true;
  }

  if (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return true;
  }

  if (
    OWNER_ROLE_ID &&
    member.roles.cache.has(OWNER_ROLE_ID)
  ) {
    return true;
  }

  if (
    CO_OWNER_ROLE_ID &&
    member.roles.cache.has(CO_OWNER_ROLE_ID)
  ) {
    return true;
  }

  return false;
}

function isSeniorStaff(member) {
  return (
    member &&
    member.roles.cache.has(SENIOR_STAFF_ROLE_ID)
  );
}

function isGeneralStaff(member) {
  return (
    member &&
    member.roles.cache.has(GENERAL_STAFF_ROLE_ID)
  );
}

function isStaff(member) {
  return (
    isSeniorStaff(member) ||
    isGeneralStaff(member)
  );
}

// =====================================================
// HELPERS
// =====================================================

async function getChannel(guild, channelId) {
  return (
    guild.channels.cache.get(channelId) ||
    await guild.channels.fetch(channelId).catch(() => null)
  );
}

async function getMember(guild, userId) {
  return (
    guild.members.cache.get(userId) ||
    await guild.members.fetch(userId).catch(() => null)
  );
}

function makeRequestId() {
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function sanitizeChannelName(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) ||
    'staff-report'
  );
}

function discordTimestamp(ms) {
  const unix = Math.floor(ms / 1000);

  return `<t:${unix}:F> • <t:${unix}:R>`;
}

function parseHours(value) {
  const number = Number(
    String(value).trim()
  );

  if (!Number.isFinite(number)) {
    return null;
  }

  return number;
}

// =====================================================
// ROLE-FILTERED DROPDOWNS
// =====================================================

function getRoleOptions(guild, roleId) {
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    return [];
  }

  return [...role.members.values()]
    .filter(member => !member.user.bot)
    .slice(0, 25)
    .map(member => ({
      label: member.displayName.slice(0, 100),
      description: member.user.username.slice(0, 100),
      value: member.id,
    }));
}

function getCombinedStaffOptions(guild) {
  const unique = new Map();

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
      if (!member.user.bot) {
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
      if (!member.user.bot) {
        unique.set(
          member.id,
          member
        );
      }
    }
  }

  return [...unique.values()]
    .slice(0, 25)
    .map(member => {
      const groups = [];

      if (
        member.roles.cache.has(
          SENIOR_STAFF_ROLE_ID
        )
      ) {
        groups.push('Senior Staff');
      }

      if (
        member.roles.cache.has(
          GENERAL_STAFF_ROLE_ID
        )
      ) {
        groups.push('General Staff');
      }

      return {
        label:
          member.displayName.slice(0, 100),

        description:
          groups.join(' + ').slice(0, 100),

        value:
          member.id,
      };
    });
}

// =====================================================
// TARGETS
// =====================================================

async function getTargets(guild, draft) {
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
        members.push(member);
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
    const seniorRole =
      guild.roles.cache.get(
        SENIOR_STAFF_ROLE_ID
      );

    const generalRole =
      guild.roles.cache.get(
        GENERAL_STAFF_ROLE_ID
      );

    const unique =
      new Map();

    if (seniorRole) {
      for (
        const member
        of seniorRole.members.values()
      ) {
        if (!member.user.bot) {
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
        if (!member.user.bot) {
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
// OWNER PANEL
// =====================================================

async function createOwnerPanel(guild) {
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
      .catch(() => null);

  const oldPanel =
    messages?.find(
      message =>
        message.author.id === client.user.id &&
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
          '**Certain Selected Staff Members** only shows members who actually have the Senior Staff or General Staff role.',
          '',
          '**Minimum deadline: 24 hours.**',
        ].join('\n')
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

  if (oldPanel) {
    await oldPanel.edit({
      embeds: [embed],
      components: [row],
    });
  } else {
    await channel.send({
      embeds: [embed],
      components: [row],
    });
  }
}

// =====================================================
// GENERAL STAFF PANEL
// =====================================================

async function createGeneralStaffPanel(guild) {
  const channel =
    await getChannel(
      guild,
      GENERAL_REPORTS_TO_MAKE_CHANNEL_ID
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 50,
      })
      .catch(() => null);

  const oldPanel =
    messages?.find(
      message =>
        message.author.id === client.user.id &&
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
          'Reports submitted here will be sent to **Senior Staff for review**.',
        ].join('\n')
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

  if (oldPanel) {
    await oldPanel.edit({
      embeds: [embed],
      components: [row],
    });
  } else {
    await channel.send({
      embeds: [embed],
      components: [row],
    });
  }
}

// =====================================================
// SENIOR STAFF PANEL
// =====================================================

async function createSeniorStaffPanel(guild) {
  const channel =
    await getChannel(
      guild,
      SENIOR_REPORTS_TO_MAKE_CHANNEL_ID
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  const messages =
    await channel.messages
      .fetch({
        limit: 50,
      })
      .catch(() => null);

  const oldPanel =
    messages?.find(
      message =>
        message.author.id === client.user.id &&
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
          'Reports submitted here go directly to the **Owner and Co-Owner**.',
        ].join('\n')
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

  if (oldPanel) {
    await oldPanel.edit({
      embeds: [embed],
      components: [row],
    });
  } else {
    await channel.send({
      embeds: [embed],
      components: [row],
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

  const reportQuestion =
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
      .setMaxLength(1500);

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
        reportQuestion
      ),

    new ActionRowBuilder()
      .addComponents(
        deadline
      )
  );

  return modal;
}

// =====================================================
// CREATE PRIVATE REQUESTED REPORT
// =====================================================

async function createPrivateRequestedReport({
  guild,
  targetMember,
  requesterId,
  reportQuestion,
  hoursUntilDue,
}) {
  const requestId =
    makeRequestId();

  const createdAt =
    Date.now();

  const dueAt =
    createdAt +
    hoursUntilDue *
      60 *
      60 *
      1000;

  const channel =
    await guild.channels.create({
      name:
        sanitizeChannelName(
          `report-${targetMember.user.username}`
        ),

      type:
        ChannelType.GuildText,

      parent:
        REQUESTED_REPORTS_CATEGORY_ID,

      permissionOverwrites: [
        {
          id:
            guild.roles.everyone.id,

          deny: [
            PermissionsBitField
              .Flags.ViewChannel,
          ],
        },

        {
          id:
            targetMember.id,

          allow: [
            PermissionsBitField
              .Flags.ViewChannel,

            PermissionsBitField
              .Flags.SendMessages,

            PermissionsBitField
              .Flags.ReadMessageHistory,
          ],
        },

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
          ],
        },

        ...(OWNER_ROLE_ID
          ? [
              {
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
              },
            ]
          : []),

        ...(CO_OWNER_ROLE_ID
          ? [
              {
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
              },
            ]
          : []),
      ],
    });

  data.requests[
    requestId
  ] = {
    requestId,
    targetUserId:
      targetMember.id,
    requesterId,
    reportQuestion,
    createdAt,
    dueAt,
    channelId:
      channel.id,
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
        ].join('\n')
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
        .catch(() => null);

    if (!guild) {
      return;
    }

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
      '✅ Staff Reports panels ready.'
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
      // REQUEST REPORT
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
              '❌ Only Owner or Co-Owner can request reports.',

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
      // CHOOSE TARGET TYPE
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
              '❌ Request expired.',

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

        // ONE SENIOR
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
                'select_one_senior_filtered'
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

        // ONE GENERAL
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
                'select_one_general_filtered'
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

        // SELECT CERTAIN STAFF
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
                'select_multiple_staff_filtered'
              )
              .setPlaceholder(
                'Select staff members'
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
      // SELECT ONE SENIOR
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'select_one_senior_filtered'
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
      // SELECT ONE GENERAL
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'select_one_general_filtered'
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
      // SELECT MULTIPLE STAFF
      // =================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          'select_multiple_staff_filtered'
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
              '❌ Deadline must be at least 24 hours.',

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
              '❌ No valid staff members found.',

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
              ].join('\n')
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
      // CONFIRM REPORT REQUEST
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

        let created = 0;

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
            `✅ Created ${created} report request(s).`,

          embeds:
            [],

          components:
            [],
        });
      }

      // =================================================
      // CANCEL
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
      // SUBMIT REQUESTED REPORT
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
              '❌ Only the assigned staff member can submit this report.',

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

        const reportBody =
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
            .setMaxLength(4000);

        const nextReport =
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
              'Example: 7 days, weekly, none'
            );

        modal.addComponents(
          new ActionRowBuilder()
            .addComponents(
              reportBody
            ),

          new ActionRowBuilder()
            .addComponents(
              nextReport
            )
        );

        return interaction.showModal(
          modal
        );
      }

      // =================================================
      // REQUESTED REPORT SUBMITTED
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
              '❌ Report is no longer open.',

            flags:
              MessageFlags.Ephemeral,
          });
        }

        const reportBody =
          interaction.fields
            .getTextInputValue(
              'requested_report_body'
            );

        const nextReport =
          interaction.fields
            .getTextInputValue(
              'next_report_time'
            );

        const destination =
          await getChannel(
            interaction.guild,
            SUBMITTED_REQUESTED_REPORTS_CHANNEL_ID
          );

        const embed =
          new EmbedBuilder()
            .setTitle(
              '📥 Submitted Requested Report'
            )
            .setDescription(
              reportBody
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
                  nextReport,
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

        saveData();

        await interaction.reply({
          content:
            '✅ Report submitted.',

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
      // GENERAL STAFF CREATE REPORT
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
              '❌ General Staff only.',

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
      // GENERAL REPORT SUBMISSION
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
            );

        const body =
          interaction.fields
            .getTextInputValue(
              'general_report_body'
            );

        const destination =
          await getChannel(
            interaction.guild,
            GENERAL_REPORTS_REVIEW_CHANNEL_ID
          );

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
      // SENIOR STAFF CREATE REPORT
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
              '❌ Senior Staff only.',

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
      // SENIOR REPORT SUBMISSION
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
            );

        const body =
          interaction.fields
            .getTextInputValue(
              'senior_report_body'
            );

        const destination =
          await getChannel(
            interaction.guild,
            SENIOR_REPORTS_DESTINATION_CHANNEL_ID
          );

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
              }
            )
            .setTimestamp();

        const pings = [];

        if (OWNER_ROLE_ID) {
          pings.push(
            `<@&${OWNER_ROLE_ID}>`
          );
        }

        if (CO_OWNER_ROLE_ID) {
          pings.push(
            `<@&${CO_OWNER_ROLE_ID}>`
          );
        }

        await destination.send({
          content:
            pings.join(' ') ||
            undefined,

          embeds:
            [embed],

          allowedMentions: {
            roles: [
              OWNER_ROLE_ID,
              CO_OWNER_ROLE_ID,
            ].filter(Boolean),
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
        await interaction.followUp({
          content:
            '❌ Something went wrong. Check the bot logs.',

          flags:
            MessageFlags.Ephemeral,
        }).catch(() => {});
      } else {
        await interaction.reply({
          content:
            '❌ Something went wrong. Check the bot logs.',

          flags:
            MessageFlags.Ephemeral,
        }).catch(() => {});
      }
    }
  }
);

// =====================================================
// LOGIN
// =====================================================

client.login(DISCORD_TOKEN);
