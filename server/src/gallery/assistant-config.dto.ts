import z from 'zod';
import { bookMapStyles } from 'src/utils/book/map-styles.js';
import { DEFAULT_OVERPASS_URL } from 'src/utils/collections/overpass.js';

// The system config sections of the AI assistant and the features built on it (photo books, collections, food
// photos), kept out of src/dtos/config.dto.ts the way src/gallery/config.dto.ts keeps the fork's own. Like that file,
// this module must stay a leaf: importing from config.dto.ts would be circular.

// Deliberate copies of the module-private `configBool` and `emptyOrUrl` in src/dtos/config.dto.ts; keep them in sync.
// (`galleryConfigBool` is not used: it is optional in the OpenAPI spec, and these switches are required.)
const configBool = z
  .preprocess(
    (val) => z.stringbool({ truthy: ['true'], falsy: ['false'], case: 'sensitive' }).safeParse(val).data ?? val,
    z.boolean(),
  )
  .nonoptional()
  .meta({ type: 'boolean' });

const emptyOrUrl = (error: string) =>
  z.string().refine((url) => url.length === 0 || z.url().safeParse(url).success, { error });

const AdminConfigAgentProfileSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z0-9_-]+$/, { error: 'Profile name may only contain lowercase letters, numbers, - and _' })
      .describe('Unique profile name'),
    command: z.string().min(1).describe('Executable that speaks the Agent Client Protocol over stdio'),
    args: z.array(z.string()).describe('Command line arguments'),
    env: z
      .array(z.object({ name: z.string().min(1), value: z.string() }).meta({ id: 'AdminConfigAgentEnvDto' }))
      .describe('Environment variables passed to the agent process'),
    passEnv: z
      .array(z.string().min(1))
      .describe('Names of server environment variables forwarded to the agent process (e.g. API keys)'),
    host: z
      .enum(['auto', 'local', 'remote'])
      .meta({ id: 'AgentProfileHost' })
      .optional()
      .describe(
        'Where the agent runs: "local" as a process of the server, "remote" on the agent host at AGENT_HOST_URL (the gallery-agents container, which forwards its own environment variables), "auto" (the default) on the agent host when AGENT_HOST_URL is set',
      ),
  })
  .describe('An ACP agent that can be started by the assistant')
  .meta({ id: 'AdminConfigAgentProfileDto' });

/** assistant routines (#15): instructions the assistant runs on its own, on a schedule or after an event */
const AssistantRoutinesSchema = z
  .object({
    enabled: configBool.describe(
      'Let the users make assistant routines, which run the assistant on its own on a schedule or after an event',
    ),
    maxRoutinesPerUser: z.int().min(1).max(100).describe('Most routines a user can have'),
    maxRunsPerDay: z
      .int()
      .min(1)
      .max(1000)
      .describe('Most routine runs of a user in 24 hours, all their routines together'),
    maxConcurrentRuns: z.int().min(1).max(20).describe('Most routine runs at the same time on this server'),
    maxRunMinutes: z.int().min(1).max(240).describe('Longest a routine run may take, in minutes'),
    maxToolCalls: z.int().min(1).max(2000).describe('Most tool calls of a routine run'),
    pauseAfterFailures: z
      .int()
      .min(1)
      .max(20)
      .describe('A routine is paused after this many failed runs in a row, until its owner resumes it'),
    approvalExpiryDays: z
      .int()
      .min(1)
      .max(90)
      .describe('Days a change of a routine run waits for approval in the Routines inbox before it expires'),
    eventSettleMinutes: z
      .int()
      .min(1)
      .max(240)
      .describe('A routine that runs after uploads (or other events) starts once no new event came for this long'),
  })
  .describe('Assistant routines config')
  .meta({ id: 'AdminConfigRoutinesDto' });

export const AssistantAgentSchema = z
  .object({
    enabled: configBool.describe('Enabled'),
    profiles: z.array(AdminConfigAgentProfileSchema).describe('Available agent profiles'),
    chatProfile: z.string().describe('Profile used for assistant chat sessions'),
    artProfile: z.string().describe('Profile used for artistic transforms (empty to disable)'),
    maxConcurrentSessions: z.int().min(1).max(100).describe('Maximum number of running agent processes'),
    idleTimeoutMinutes: z.int().min(1).max(1440).describe('Stop an idle agent process after this many minutes'),
    autoApproveWrites: configBool.describe('Allow the agent to modify the library without asking for approval'),
    activityRetentionDays: z
      .int()
      .min(1)
      .max(3650)
      .describe('Days the activity log keeps the changes made by the assistant, which can be undone until then'),
    mcpUrl: emptyOrUrl('MCP URL must be an empty string or a valid URL').describe(
      'URL the agent uses to reach the Immich MCP endpoint (empty for http://127.0.0.1:<port>/api/agent/mcp)',
    ),
    routines: AssistantRoutinesSchema,
  })
  .describe('AI assistant (Agent Client Protocol) config')
  .meta({ id: 'AdminConfigAgentDto' });

export const AssistantBooksSchema = z
  .object({
    maps: z
      .object({
        stadiaApiKey: z
          .string()
          .describe(
            'Stadia Maps API key for the watercolor, toner and terrain map styles (not needed for styled and sketch maps)',
          ),
        defaultStyle: z
          .enum(bookMapStyles)
          .describe(
            'Map style used when a book asks for the automatic style; styled maps draw the map data of the Map page',
          ),
      })
      .meta({ id: 'AdminConfigBookMapsDto' }),
    drafts: z
      .object({
        enabled: configBool.describe(
          'Draft photo books for the users in the background with the nightly tasks (a year of a collection, a trip, a birthday), for them to keep or discard',
        ),
        maxPerRun: z.int().min(1).max(20).describe('Most books drafted for a user per run'),
        yearly: configBool.describe('Draft a book of a year of a collection, e.g. "2026 in food"'),
        trips: configBool.describe('Draft a book of every trip'),
        birthdays: configBool.describe(
          'Draft a book of the year that ended on the latest birthday of the named people with a birth date',
        ),
      })
      .meta({ id: 'AdminConfigBookDraftsDto' }),
  })
  .describe('Photo book config')
  .meta({ id: 'AdminConfigBooksDto' });

export const AssistantCollectionsSchema = z
  .object({
    notifications: z
      .object({
        enabled: configBool.describe(
          'Notify the users of new visits of the collections (a meal, a museum visit, a tasting) in their new uploads that nobody named yet, with the nightly tasks',
        ),
        maxPerRun: z.int().min(1).max(20).describe('Most notifications sent to a user per run'),
        windowDays: z
          .int()
          .min(1)
          .max(90)
          .describe('Only photos uploaded in this many days are looked at, however long ago the last run was'),
      })
      .meta({ id: 'AdminConfigCollectionNotificationsDto' }),
  })
  .describe('Collections config')
  .meta({ id: 'AdminConfigCollectionsDto' });

export const AssistantFoodSchema = z
  .object({
    openStreetMap: z
      .object({
        enabled: configBool.describe(
          'Let the assistant look up restaurants near the location of a meal on OpenStreetMap (sends the location to the Overpass API)',
        ),
        overpassUrl: z.url().describe('URL of the Overpass API interpreter'),
      })
      .meta({ id: 'AdminConfigFoodOpenStreetMapDto' }),
  })
  .describe('Food photos config')
  .meta({ id: 'AdminConfigFoodDto' });

export const AssistantMemoryNotificationsSchema = z
  .object({
    enabled: configBool.describe(
      'Send each user at most one notification a day of a memory (on this day, a trip anniversary) or a suggested photo book waiting for them, at the time of day they choose',
    ),
    digest: configBool.describe(
      "Let the users get a weekly email of the week's memories, waiting drafts and new journal visits (off for each user until they turn it on; needs email to be set up)",
    ),
  })
  .describe('Memory notifications config')
  .meta({ id: 'AdminConfigMemoryNotificationsDto' });

export const assistantTopLevelDefaults = {
  agent: {
    enabled: false,
    profiles: [
      {
        name: 'claude',
        command: 'claude-agent-acp',
        args: [],
        env: [],
        passEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_EXECUTABLE'],
      },
      { name: 'codex', command: 'codex-acp', args: [], env: [], passEnv: ['OPENAI_API_KEY', 'CODEX_PATH'] },
    ],
    chatProfile: 'claude',
    artProfile: '',
    maxConcurrentSessions: 3,
    idleTimeoutMinutes: 15,
    autoApproveWrites: false,
    activityRetentionDays: 90,
    mcpUrl: '',
    routines: {
      enabled: true,
      maxRoutinesPerUser: 20,
      maxRunsPerDay: 24,
      maxConcurrentRuns: 1,
      maxRunMinutes: 30,
      maxToolCalls: 200,
      pauseAfterFailures: 3,
      approvalExpiryDays: 7,
      eventSettleMinutes: 10,
    },
  },
  books: {
    maps: {
      stadiaApiKey: '',
      defaultStyle: 'styled' as const,
    },
    drafts: {
      enabled: true,
      maxPerRun: 3,
      yearly: true,
      trips: true,
      birthdays: true,
    },
  },
  collections: {
    notifications: {
      // the photos several packs find go to the pack that fits them best (see `arbitrateVisits`)
      enabled: true,
      maxPerRun: 3,
      windowDays: 14,
    },
  },
  food: {
    openStreetMap: {
      enabled: false,
      overpassUrl: DEFAULT_OVERPASS_URL,
    },
  },
  memoryNotifications: {
    enabled: true,
    digest: true,
  },
};
