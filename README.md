# StaffReports

Updated Staff Reports Discord bot.

## Environment variables
- `DISCORD_TOKEN` — required
- `OWNER_ROLE_ID` — optional owner role
- `CO_OWNER_ROLE_ID` — optional co-owner role

This update avoids repeatedly fetching every guild member, which helps prevent Discord Gateway opcode 8 rate limits.
