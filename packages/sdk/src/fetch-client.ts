/**
 * Immich
 * 3.2.0
 * DO NOT MODIFY - This file has been generated using oazapfts.
 * See https://www.npmjs.com/package/oazapfts
 */
import * as Oazapfts from "@oazapfts/runtime";
import * as QS from "@oazapfts/runtime/query";
export const defaults: Oazapfts.Defaults<Oazapfts.CustomHeaders> = {
    headers: {},
    baseUrl: "/api"
};
const oazapfts = Oazapfts.runtime(defaults);
export const servers = {
    server1: "/api"
};
export type UserResponseDto = {
    avatarColor: UserAvatarColor;
    /** User email */
    email: string;
    /** User ID */
    id: string;
    /** User name */
    name: string;
    /** Profile change date */
    profileChangedAt: string;
    /** Profile image path */
    profileImagePath: string;
};
export type ActivityResponseDto = {
    /** Asset ID (if activity is for an asset) */
    assetId: string | null;
    /** Comment text (for comment activities) */
    comment?: string | null;
    /** Creation date */
    createdAt: string;
    /** Activity ID */
    id: string;
    "type": ReactionType;
    user: UserResponseDto;
};
export type ActivityCreateDto = {
    /** Album ID */
    albumId: string;
    /** Asset ID (if activity is for an asset) */
    assetId?: string;
    /** Comment text (required if type is comment) */
    comment?: string;
    "type": ReactionType;
};
export type ActivityStatisticsResponseDto = {
    /** Number of comments */
    comments: number;
    /** Number of likes */
    likes: number;
};
export type AdminConfigAgentEnvDto = {
    name: string;
    value: string;
};
export type AdminConfigAgentProfileDto = {
    /** Command line arguments */
    args: string[];
    /** Executable that speaks the Agent Client Protocol over stdio */
    command: string;
    /** Environment variables passed to the agent process */
    env: AdminConfigAgentEnvDto[];
    /** Unique profile name */
    name: string;
    /** Names of server environment variables forwarded to the agent process (e.g. API keys) */
    passEnv: string[];
};
export type AdminConfigAgentDto = {
    /** Profile used for artistic transforms (empty to disable) */
    artProfile: string;
    /** Allow the agent to modify the library without asking for approval */
    autoApproveWrites: boolean;
    /** Profile used for assistant chat sessions */
    chatProfile: string;
    /** Enabled */
    enabled: boolean;
    /** Stop an idle agent process after this many minutes */
    idleTimeoutMinutes: number;
    /** Maximum number of running agent processes */
    maxConcurrentSessions: number;
    /** URL the agent uses to reach the Immich MCP endpoint (empty for http://127.0.0.1:<port>/api/agent/mcp) */
    mcpUrl: string;
    /** Available agent profiles */
    profiles: AdminConfigAgentProfileDto[];
};
export type AdminConfigDatabaseBackupDto = {
    /** Cron expression */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
    /** Keep last amount */
    keepLastAmount: number;
};
export type AdminConfigBackupsDto = {
    database: AdminConfigDatabaseBackupDto;
};
export type AdminConfigBookMapsDto = {
    /** Map style used when a book asks for the automatic style */
    defaultStyle: DefaultStyle;
    /** Stadia Maps API key for the watercolor, toner and terrain map styles (empty for sketch maps only) */
    stadiaApiKey: string;
};
export type AdminConfigBooksDto = {
    maps: AdminConfigBookMapsDto;
};
export type AdminConfigFFmpegRealtimeDto = {
    /** Enable real-time HLS transcoding (alpha) */
    enabled: boolean;
    /** Resolutions to use for real-time HLS transcoding */
    resolutions: HlsVideoResolution[];
    /** Video codecs to use for real-time HLS transcoding */
    videoCodecs: VideoCodec[];
};
export type AdminConfigFFmpegDto = {
    accel: TranscodeHWAccel;
    /** Accelerated decode */
    accelDecode: boolean;
    /** Accepted audio codecs */
    acceptedAudioCodecs: AudioCodec[];
    /** Accepted containers */
    acceptedContainers: VideoContainer[];
    /** Accepted video codecs */
    acceptedVideoCodecs: VideoCodec[];
    /** B-frames */
    bframes: number;
    cqMode: CQMode;
    /** CRF */
    crf: number;
    /** GOP size */
    gopSize: number;
    /** Max bitrate */
    maxBitrate: string;
    /** Preferred hardware device */
    preferredHwDevice: string;
    /** Preset */
    preset: string;
    realtime: AdminConfigFFmpegRealtimeDto;
    /** References */
    refs: number;
    targetAudioCodec: AudioCodec;
    /** Target resolution */
    targetResolution: string;
    targetVideoCodec: VideoCodec;
    /** Temporal AQ */
    temporalAQ: boolean;
    /** Threads */
    threads: number;
    tonemap: ToneMapping;
    transcode: TranscodePolicy;
    /** Two pass */
    twoPass: boolean;
};
export type AdminConfigFoodOpenStreetMapDto = {
    /** Let the assistant look up restaurants near the location of a meal on OpenStreetMap (sends the location to the Overpass API) */
    enabled: boolean;
    /** URL of the Overpass API interpreter */
    overpassUrl: string;
};
export type AdminConfigFoodDto = {
    openStreetMap: AdminConfigFoodOpenStreetMapDto;
};
export type AdminConfigGeneratedFullsizeImageDto = {
    /** Enabled */
    enabled: boolean;
    format: ImageFormat;
    /** Progressive */
    progressive?: boolean;
    /** Quality */
    quality: number;
};
export type AdminConfigGeneratedImageDto = {
    format: ImageFormat;
    /** Progressive */
    progressive?: boolean;
    /** Quality */
    quality: number;
    /** Size */
    size: number;
};
export type AdminConfigImageDto = {
    colorspace: Colorspace;
    /** Extract embedded */
    extractEmbedded: boolean;
    fullsize: AdminConfigGeneratedFullsizeImageDto;
    preview: AdminConfigGeneratedImageDto;
    thumbnail: AdminConfigGeneratedImageDto;
};
export type AdminConfigIntegrityChecksumJobDto = {
    /** Cron expression for when the integrity check should run */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
    /** Percentage limit of the integrity checksum job */
    percentageLimit: number;
    /** How long the integrity checksum job may run for */
    timeLimit: number;
};
export type AdminConfigIntegrityJobDto = {
    /** Cron expression for when the integrity check should run */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigIntegrityChecksDto = {
    checksumFiles: AdminConfigIntegrityChecksumJobDto;
    missingFiles: AdminConfigIntegrityJobDto;
    untrackedFiles: AdminConfigIntegrityJobDto;
};
export type AdminConfigJobSettingsDto = {
    /** Concurrency */
    concurrency: number;
};
export type AdminConfigJobDto = {
    backgroundTask: AdminConfigJobSettingsDto;
    editor: AdminConfigJobSettingsDto;
    faceDetection: AdminConfigJobSettingsDto;
    integrityCheck: AdminConfigJobSettingsDto;
    library: AdminConfigJobSettingsDto;
    metadataExtraction: AdminConfigJobSettingsDto;
    migration: AdminConfigJobSettingsDto;
    notifications: AdminConfigJobSettingsDto;
    ocr: AdminConfigJobSettingsDto;
    search: AdminConfigJobSettingsDto;
    sidecar: AdminConfigJobSettingsDto;
    smartSearch: AdminConfigJobSettingsDto;
    thumbnailGeneration: AdminConfigJobSettingsDto;
    videoConversion: AdminConfigJobSettingsDto;
    workflow: AdminConfigJobSettingsDto;
};
export type AdminConfigLibraryScanDto = {
    /** Cron expression */
    cronExpression: string;
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigLibraryWatchDto = {
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigLibraryDto = {
    scan: AdminConfigLibraryScanDto;
    watch: AdminConfigLibraryWatchDto;
};
export type AdminConfigLoggingDto = {
    /** Enabled */
    enabled: boolean;
    level: LogLevel;
};
export type AdminConfigMachineLearningAvailabilityChecksDto = {
    /** Enabled */
    enabled: boolean;
    interval: number;
    timeout: number;
};
export type AdminConfigClipDto = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Name of the model to use */
    modelName: string;
};
export type AdminConfigDuplicateDetectionDto = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum distance threshold for duplicate detection */
    maxDistance: number;
};
export type AdminConfigFacialRecognitionDto = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum distance threshold for face recognition */
    maxDistance: number;
    /** Minimum number of faces required for recognition */
    minFaces: number;
    /** Minimum confidence score for face detection */
    minScore: number;
    /** Name of the model to use */
    modelName: string;
};
export type AdminConfigOcrDto = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Maximum resolution for OCR processing */
    maxResolution: number;
    /** Minimum confidence score for text detection */
    minDetectionScore: number;
    /** Minimum confidence score for text recognition */
    minRecognitionScore: number;
    /** Name of the model to use */
    modelName: string;
};
export type AdminConfigMachineLearningDto = {
    availabilityChecks: AdminConfigMachineLearningAvailabilityChecksDto;
    clip: AdminConfigClipDto;
    duplicateDetection: AdminConfigDuplicateDetectionDto;
    /** Enabled */
    enabled: boolean;
    facialRecognition: AdminConfigFacialRecognitionDto;
    ocr: AdminConfigOcrDto;
    /** ML service URLs */
    urls: string[];
};
export type AdminConfigMapDto = {
    /** Dark map style URL */
    darkStyle: string;
    /** Enabled */
    enabled: boolean;
    /** Light map style URL */
    lightStyle: string;
};
export type AdminConfigFacesDto = {
    /** Import */
    "import": boolean;
};
export type AdminConfigMetadataDto = {
    faces: AdminConfigFacesDto;
};
export type AdminConfigNewVersionCheckDto = {
    channel: ReleaseChannel;
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigNightlyTasksDto = {
    /** Cluster new faces */
    clusterNewFaces: boolean;
    /** Database cleanup */
    databaseCleanup: boolean;
    /** Generate memories */
    generateMemories: boolean;
    /** Missing thumbnails */
    missingThumbnails: boolean;
    /** Start time (HH:MM) */
    startTime: string;
    /** Sync quota usage */
    syncQuotaUsage: boolean;
};
export type AdminConfigSmtpTransportDto = {
    /** SMTP server hostname */
    host: string;
    /** Whether to ignore SSL certificate errors */
    ignoreCert: boolean;
    /** SMTP password */
    password: string;
    /** SMTP server port */
    port: number;
    /** Whether to use secure connection (TLS/SSL) */
    secure: boolean;
    /** SMTP username */
    username: string;
};
export type AdminConfigSmtpDto = {
    /** Whether SMTP email notifications are enabled */
    enabled: boolean;
    /** Email address to send from */
    "from": string;
    /** Email address for replies */
    replyTo: string;
    transport: AdminConfigSmtpTransportDto;
};
export type AdminConfigNotificationsDto = {
    smtp: AdminConfigSmtpDto;
};
export type AdminConfigOAuthDto = {
    /** Account management URL */
    accountManagementUrl?: string;
    /** Allow insecure requests */
    allowInsecureRequests: boolean;
    /** Auto launch */
    autoLaunch: boolean;
    /** Auto register */
    autoRegister: boolean;
    /** Button text */
    buttonText: string;
    /** Client ID */
    clientId: string;
    /** Client secret */
    clientSecret: string;
    /** Default storage quota */
    defaultStorageQuota: number | null;
    /** Enabled */
    enabled: boolean;
    /** End session endpoint */
    endSessionEndpoint: string;
    /** Issuer URL */
    issuerUrl: string;
    /** Mobile override enabled */
    mobileOverrideEnabled: boolean;
    /** Mobile redirect URI (set to empty string to disable) */
    mobileRedirectUri: string;
    /** Profile signing algorithm */
    profileSigningAlgorithm: string;
    /** OAuth prompt parameter (e.g. select_account, login, consent) */
    prompt: string;
    /** Role claim */
    roleClaim: string;
    /** Scope */
    scope: string;
    /** Signing algorithm */
    signingAlgorithm: string;
    /** Storage label claim */
    storageLabelClaim: string;
    /** Storage quota claim */
    storageQuotaClaim: string;
    /** Timeout */
    timeout: number;
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
};
export type AdminConfigPasswordLoginDto = {
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigReverseGeocodingDto = {
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigServerDto = {
    /** External domain */
    externalDomain: string;
    /** Login page message */
    loginPageMessage: string;
    /** Public users */
    publicUsers: boolean;
};
export type AdminConfigStorageTemplateDto = {
    /** Enabled */
    enabled: boolean;
    /** Hash verification enabled */
    hashVerificationEnabled: boolean;
    /** Template */
    template: string;
};
export type AdminConfigTemplateEmailsDto = {
    /** Album invite template */
    albumInviteTemplate: string;
    /** Album update template */
    albumUpdateTemplate: string;
    /** Welcome template */
    welcomeTemplate: string;
};
export type AdminConfigTemplatesDto = {
    email: AdminConfigTemplateEmailsDto;
};
export type AdminConfigThemeDto = {
    /** Custom CSS for theming */
    customCss: string;
};
export type AdminConfigTrashDto = {
    /** Days */
    days: number;
    /** Enabled */
    enabled: boolean;
};
export type AdminConfigUserDto = {
    /** Delete delay */
    deleteDelay: number;
};
export type AdminConfigDto = {
    agent: AdminConfigAgentDto;
    backup: AdminConfigBackupsDto;
    books: AdminConfigBooksDto;
    ffmpeg: AdminConfigFFmpegDto;
    food: AdminConfigFoodDto;
    image: AdminConfigImageDto;
    integrityChecks: AdminConfigIntegrityChecksDto;
    job: AdminConfigJobDto;
    library: AdminConfigLibraryDto;
    logging: AdminConfigLoggingDto;
    machineLearning: AdminConfigMachineLearningDto;
    map: AdminConfigMapDto;
    metadata: AdminConfigMetadataDto;
    newVersionCheck: AdminConfigNewVersionCheckDto;
    nightlyTasks: AdminConfigNightlyTasksDto;
    notifications: AdminConfigNotificationsDto;
    oauth: AdminConfigOAuthDto;
    passwordLogin: AdminConfigPasswordLoginDto;
    reverseGeocoding: AdminConfigReverseGeocodingDto;
    server: AdminConfigServerDto;
    storageTemplate: AdminConfigStorageTemplateDto;
    templates: AdminConfigTemplatesDto;
    theme: AdminConfigThemeDto;
    trash: AdminConfigTrashDto;
    user: AdminConfigUserDto;
};
export type DatabaseBackupDeleteDto = {
    /** Backup filenames to delete */
    backups: string[];
};
export type DatabaseBackupDto = {
    /** Backup filename */
    filename: string;
    /** Backup file size */
    filesize: number;
    /** Backup timezone */
    timezone: string;
};
export type DatabaseBackupListResponseDto = {
    /** List of backups */
    backups: DatabaseBackupDto[];
};
export type DatabaseBackupUploadDto = {
    /** Database backup file */
    file?: Blob;
};
export type IntegrityReportResponseDto = {
    items: {
        /** Integrity report item id */
        id: string;
        /** Integrity report item path */
        path: string;
        "type": IntegrityReport;
    }[];
    nextCursor?: string;
};
export type IntegrityReportSummaryResponseDto = {
    checksum_mismatch: number;
    missing_file: number;
    untracked_file: number;
};
export type SetMaintenanceModeDto = {
    action: MaintenanceAction;
    /** Restore backup filename */
    restoreBackupFilename?: string;
};
export type MaintenanceDetectInstallStorageFolderDto = {
    /** Number of files in the folder */
    files: number;
    folder: StorageFolder;
    /** Whether the folder is readable */
    readable: boolean;
    /** Whether the folder is writable */
    writable: boolean;
};
export type MaintenanceDetectInstallResponseDto = {
    storage: MaintenanceDetectInstallStorageFolderDto[];
};
export type MaintenanceLoginDto = {
    /** Maintenance token */
    token?: string;
};
export type MaintenanceAuthDto = {
    /** Maintenance username */
    username: string;
};
export type MaintenanceStatusResponseDto = {
    action: MaintenanceAction;
    active: boolean;
    error?: string;
    progress?: number;
    task?: string;
};
export type NotificationCreateDto = {
    /** Additional notification data */
    data?: {
        [key: string]: any;
    };
    /** Notification description */
    description?: string | null;
    level?: NotificationLevel;
    /** Date when notification was read */
    readAt?: string | null;
    /** Notification title */
    title: string;
    "type"?: NotificationType;
    /** User ID to send notification to */
    userId: string;
};
export type NotificationDto = {
    /** Creation date */
    createdAt: string;
    /** Additional notification data */
    data?: {
        [key: string]: any;
    };
    /** Notification description */
    description?: string;
    /** Notification ID */
    id: string;
    level: NotificationLevel;
    /** Date when notification was read */
    readAt?: string;
    /** Notification title */
    title: string;
    "type": NotificationType;
};
export type TemplateDto = {
    /** Template name */
    template: string;
};
export type TemplateResponseDto = {
    /** Template HTML content */
    html: string;
    /** Template name */
    name: string;
};
export type TestEmailResponseDto = {
    /** Email message ID */
    messageId: string;
};
export type UserLicense = {
    /** Activation date */
    activatedAt: string;
    /** Activation key */
    activationKey: string;
    /** License key (format: /^IM(SV|CL)(-[\dA-Za-z]{4}){8}$/) */
    licenseKey: string;
};
export type UserAdminResponseDto = {
    avatarColor: UserAvatarColor;
    /** Cluster group the user is a member of */
    clusterGroupId: string;
    /** Creation date */
    createdAt: string;
    /** Deletion date */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User ID */
    id: string;
    /** Is admin user */
    isAdmin: boolean;
    license: (UserLicense) | null;
    /** User name */
    name: string;
    /** OAuth ID */
    oauthId: string;
    /** Profile change date */
    profileChangedAt: string;
    /** Profile image path */
    profileImagePath: string;
    /** Storage quota in bytes */
    quotaSizeInBytes: number | null;
    /** Storage usage in bytes */
    quotaUsageInBytes: number | null;
    /** Require password change on next login */
    shouldChangePassword: boolean;
    status: UserStatus;
    /** Storage label */
    storageLabel: string | null;
    /** Last update date */
    updatedAt: string;
};
export type UserAdminCreateDto = {
    avatarColor?: (UserAvatarColor) | null;
    /** User email */
    email: string;
    /** Grant admin privileges */
    isAdmin?: boolean;
    /** User name */
    name: string;
    /** Send notification email */
    notify?: boolean;
    /** User password */
    password: string;
    /** PIN code */
    pinCode?: string | null;
    /** Storage quota in bytes */
    quotaSizeInBytes?: number | null;
    /** Require password change on next login */
    shouldChangePassword?: boolean;
    /** Storage label */
    storageLabel?: string | null;
};
export type UserAdminDeleteDto = {
    /** Force delete even if user has assets */
    force?: boolean;
};
export type UserAdminUpdateDto = {
    avatarColor?: (UserAvatarColor) | null;
    /** User email */
    email?: string;
    /** Grant admin privileges */
    isAdmin?: boolean;
    /** User name */
    name?: string;
    /** User password */
    password?: string;
    /** PIN code */
    pinCode?: string | null;
    /** Storage quota in bytes */
    quotaSizeInBytes?: number | null;
    /** Require password change on next login */
    shouldChangePassword?: boolean;
    /** Storage label */
    storageLabel?: string | null;
};
export type CalendarHeatmapResponseDto = {
    /** Start date in UTC */
    "from": string;
    series: {
        /** Activity count */
        count: number;
        /** Date in UTC */
        date: string;
    }[];
    /** End date in UTC */
    to: string;
    /** Total activity count over the period */
    totalCount: number;
};
export type AlbumsResponse = {
    defaultAssetOrder: AssetOrder;
};
export type CastResponse = {
    /** Whether Google Cast is enabled */
    gCastEnabled: boolean;
};
export type DownloadResponse = {
    /** Maximum archive size in bytes */
    archiveSize: number;
    /** Whether to include embedded videos in downloads */
    includeEmbeddedVideos: boolean;
};
export type EmailNotificationsResponse = {
    /** Whether to receive email notifications for album invites */
    albumInvite: boolean;
    /** Whether to receive email notifications for album updates */
    albumUpdate: boolean;
    /** Whether email notifications are enabled */
    enabled: boolean;
};
export type FoldersResponse = {
    /** Whether folders are enabled */
    enabled: boolean;
    /** Whether folders appear in web sidebar */
    sidebarWeb: boolean;
};
export type MemoriesResponse = {
    /** Memory duration in seconds */
    duration: number;
    /** Whether memories are enabled */
    enabled: boolean;
    /** Whether memories appear in web sidebar */
    sidebarWeb: boolean;
};
export type PeopleResponse = {
    /** Whether people are enabled */
    enabled: boolean;
    /** People face threshold */
    minimumFaces?: number;
    /** Whether people appear in web sidebar */
    sidebarWeb: boolean;
};
export type PurchaseResponse = {
    /** Date until which to hide buy button */
    hideBuyButtonUntil: string;
    /** Whether to show support badge */
    showSupportBadge: boolean;
};
export type RatingsResponse = {
    /** Whether ratings are enabled */
    enabled: boolean;
};
export type RecentlyAddedResponse = {
    /** Whether the recently added page appears in the web sidebar */
    sidebarWeb: boolean;
};
export type SharedLinksResponse = {
    /** Whether shared links are enabled */
    enabled: boolean;
    /** Whether shared links appear in web sidebar */
    sidebarWeb: boolean;
};
export type TagsResponse = {
    /** Whether tags are enabled */
    enabled: boolean;
    /** Whether tags appear in web sidebar */
    sidebarWeb: boolean;
};
export type UserPreferencesResponseDto = {
    albums: AlbumsResponse;
    cast: CastResponse;
    download: DownloadResponse;
    emailNotifications: EmailNotificationsResponse;
    folders: FoldersResponse;
    memories: MemoriesResponse;
    people: PeopleResponse;
    purchase: PurchaseResponse;
    ratings: RatingsResponse;
    recentlyAdded: RecentlyAddedResponse;
    sharedLinks: SharedLinksResponse;
    tags: TagsResponse;
};
export type AlbumsUpdate = {
    defaultAssetOrder?: AssetOrder;
};
export type AvatarUpdate = {
    color?: UserAvatarColor;
};
export type CastUpdate = {
    /** Whether Google Cast is enabled */
    gCastEnabled?: boolean;
};
export type DownloadUpdate = {
    /** Maximum archive size in bytes */
    archiveSize?: number;
    /** Whether to include embedded videos in downloads */
    includeEmbeddedVideos?: boolean;
};
export type EmailNotificationsUpdate = {
    /** Whether to receive email notifications for album invites */
    albumInvite?: boolean;
    /** Whether to receive email notifications for album updates */
    albumUpdate?: boolean;
    /** Whether email notifications are enabled */
    enabled?: boolean;
};
export type FoldersUpdate = {
    /** Whether folders are enabled */
    enabled?: boolean;
    /** Whether folders appear in web sidebar */
    sidebarWeb?: boolean;
};
export type MemoriesUpdate = {
    /** Memory duration in seconds */
    duration?: number;
    /** Whether memories are enabled */
    enabled?: boolean;
    /** Whether memories appear in web sidebar */
    sidebarWeb?: boolean;
};
export type PeopleUpdate = {
    /** Whether people are enabled */
    enabled?: boolean;
    /** People face threshold */
    minimumFaces?: number;
    /** Whether people appear in web sidebar */
    sidebarWeb?: boolean;
};
export type PurchaseUpdate = {
    /** Date until which to hide buy button */
    hideBuyButtonUntil?: string;
    /** Whether to show support badge */
    showSupportBadge?: boolean;
};
export type RatingsUpdate = {
    /** Whether ratings are enabled */
    enabled?: boolean;
};
export type RecentlyAddedUpdate = {
    /** Whether the recently added page appears in the web sidebar */
    sidebarWeb?: boolean;
};
export type SharedLinksUpdate = {
    /** Whether shared links are enabled */
    enabled?: boolean;
    /** Whether shared links appear in web sidebar */
    sidebarWeb?: boolean;
};
export type TagsUpdate = {
    /** Whether tags are enabled */
    enabled?: boolean;
    /** Whether tags appear in web sidebar */
    sidebarWeb?: boolean;
};
export type UserPreferencesUpdateDto = {
    albums?: AlbumsUpdate;
    avatar?: AvatarUpdate;
    cast?: CastUpdate;
    download?: DownloadUpdate;
    emailNotifications?: EmailNotificationsUpdate;
    folders?: FoldersUpdate;
    memories?: MemoriesUpdate;
    people?: PeopleUpdate;
    purchase?: PurchaseUpdate;
    ratings?: RatingsUpdate;
    recentlyAdded?: RecentlyAddedUpdate;
    sharedLinks?: SharedLinksUpdate;
    tags?: TagsUpdate;
};
export type SessionResponseDto = {
    /** App version */
    appVersion: string | null;
    /** Creation date */
    createdAt: string;
    /** Is current session */
    current: boolean;
    /** Device OS */
    deviceOS: string;
    /** Device type */
    deviceType: string;
    /** Expiration date */
    expiresAt?: string;
    /** Session ID */
    id: string;
    /** Is pending sync reset */
    isPendingSyncReset: boolean;
    /** Last update date */
    updatedAt: string;
};
export type AssetStatsResponseDto = {
    /** Number of images */
    images: number;
    /** Total number of assets */
    total: number;
    /** Number of videos */
    videos: number;
};
export type AgentSessionResponseDto = {
    /** Whether changes to the library are approved automatically in this session */
    autoApprove: boolean;
    /** Creation date */
    createdAt: string;
    /** Session ID */
    id: string;
    /** Agent profile */
    profile: string;
    status: AgentSessionStatus;
    /** Session title */
    title: string | null;
    /** Last update date */
    updatedAt: string;
};
export type AgentSessionCreateDto = {
    /** Let the assistant change the library without asking, in this session */
    autoApprove?: boolean;
    /** Session title */
    title?: string;
};
export type AgentPlanEntryDto = {
    /** Plan step */
    content: string;
    /** Priority (high, medium, low) */
    priority: string;
    /** Status (pending, in_progress, completed) */
    status: string;
};
export type AgentPermissionOptionDto = {
    /** Option kind */
    kind: Kind;
    /** Option label */
    name: string;
    /** Option ID */
    optionId: string;
};
export type AgentMessageContentDto = {
    /** Albums referenced by tool results */
    albumIds?: string[];
    /** Assets referenced by the message (context or tool results) */
    assetIds?: string[];
    /** Books referenced by tool results */
    bookIds?: string[];
    /** Plan entries (plan) */
    entries?: AgentPlanEntryDto[];
    /** Compact tool input (tool_call, permission) */
    input?: any;
    /** Permission options (permission) */
    options?: AgentPermissionOptionDto[];
    /** Truncated tool output (tool_call) */
    output?: string;
    /** Permission request ID, used to respond (permission) */
    requestId?: string;
    /** Tool call status (pending, in_progress, completed, failed) or permission status */
    status?: string;
    /** Human readable summary of the tool arguments (permission) */
    summary?: string;
    /** Text (text, thought and error messages), markdown for agent text */
    text?: string;
    /** Human readable title (tool_call, permission) */
    title?: string;
    /** Tool call ID (tool_call) */
    toolCallId?: string;
    /** Immich tool name, or the agent tool name (tool_call, permission) */
    toolName?: string;
};
export type AgentMessageDto = {
    content: AgentMessageContentDto;
    /** Creation date */
    createdAt: string;
    /** Message ID */
    id: string;
    kind: AgentMessageKind;
    role: AgentMessageRole;
    /** Session ID */
    sessionId: string;
};
export type AgentSessionDetailResponseDto = {
    /** Whether changes to the library are approved automatically in this session */
    autoApprove: boolean;
    /** Creation date */
    createdAt: string;
    /** Session ID */
    id: string;
    /** Messages, oldest first */
    messages: AgentMessageDto[];
    /** Agent profile */
    profile: string;
    status: AgentSessionStatus;
    /** Session title */
    title: string | null;
    /** Last update date */
    updatedAt: string;
};
export type AgentSessionUpdateDto = {
    /** Let the assistant change the library without asking, in this session */
    autoApprove?: boolean;
    /** Session title */
    title?: string;
};
export type AgentPermissionResponseDto = {
    /** Whether the request is approved (alternative to optionId) */
    approved?: boolean;
    /** Selected permission option ID */
    optionId?: string;
};
export type AgentPromptDto = {
    /** Assets selected by the user, passed as context */
    assetIds?: string[];
    /** Message for the assistant */
    text: string;
};
export type AlbumUserResponseDto = {
    role: AlbumUserRole;
    user: UserResponseDto;
};
export type ContributorCountResponseDto = {
    /** Number of assets contributed */
    assetCount: number;
    /** User ID */
    userId: string;
};
export type AlbumResponseDto = {
    /** Album name */
    albumName: string;
    /** Thumbnail asset ID */
    albumThumbnailAssetId: string | null;
    /** First entry is always the album owner. Second entry is the auth user, if it differs from the owner. The rest are ordered alphabetically. */
    albumUsers: AlbumUserResponseDto[];
    /** Number of assets */
    assetCount: number;
    contributorCounts?: ContributorCountResponseDto[];
    /** Creation date */
    createdAt: string;
    /** Album description */
    description: string;
    /** UTC representation of (local) end date (latest asset) */
    endDate?: string;
    /** Has shared link */
    hasSharedLink: boolean;
    /** Album ID */
    id: string;
    /** Activity feed enabled */
    isActivityEnabled: boolean;
    /** Last modified asset timestamp */
    lastModifiedAssetTimestamp?: string;
    order?: AssetOrder;
    /** Is shared album */
    shared: boolean;
    /** UTC representation of (local) start date (earliest asset) */
    startDate?: string;
    /** Last update date */
    updatedAt: string;
};
export type AlbumUserCreateDto = {
    role: AlbumUserRole;
    /** User ID */
    userId: string;
};
export type CreateAlbumDto = {
    /** Album name */
    albumName: string;
    /** Album users */
    albumUsers?: AlbumUserCreateDto[];
    /** Initial asset IDs */
    assetIds?: string[];
    /** Album description */
    description?: string | null;
};
export type AlbumsAddAssetsDto = {
    /** Album IDs */
    albumIds: string[];
    /** Asset IDs */
    assetIds: string[];
};
export type AlbumsAddAssetsResponseDto = {
    error?: BulkIdErrorReason;
    /** Operation success */
    success: boolean;
};
export type AlbumStatisticsResponseDto = {
    /** Number of non-shared albums */
    notShared: number;
    /** Number of owned albums */
    owned: number;
    /** Number of shared albums */
    shared: number;
};
export type UpdateAlbumDto = {
    /** Album name */
    albumName?: string;
    /** Album thumbnail asset ID */
    albumThumbnailAssetId?: string;
    /** Album description */
    description?: string | null;
    /** Enable activity feed */
    isActivityEnabled?: boolean;
    order?: AssetOrder;
};
export type BulkIdsDto = {
    /** IDs to process */
    ids: string[];
};
export type BulkIdResponseDto = {
    error?: BulkIdErrorReason;
    errorMessage?: string;
    /** ID */
    id: string;
    /** Whether operation succeeded */
    success: boolean;
};
export type MapMarkerResponseDto = {
    /** City name */
    city: string | null;
    /** Country name */
    country: string | null;
    /** Asset ID */
    id: string;
    /** Latitude */
    lat: number;
    /** Longitude */
    lon: number;
    /** State/Province name */
    state: string | null;
};
export type UpdateAlbumUserDto = {
    role: AlbumUserRole;
};
export type AlbumUserAddDto = {
    /** Album user role */
    role?: AlbumUserRole;
    /** User ID */
    userId: string;
};
export type AddUsersDto = {
    /** Album users to add */
    albumUsers: AlbumUserAddDto[];
};
export type ApiKeyResponseDto = {
    /** Creation date */
    createdAt: string;
    /** API key ID */
    id: string;
    /** API key name */
    name: string;
    /** List of permissions */
    permissions: Permission[];
    /** Last update date */
    updatedAt: string;
};
export type ApiKeyCreateDto = {
    /** API key name */
    name?: string;
    /** List of permissions */
    permissions: Permission[];
};
export type ApiKeyCreateResponseDto = {
    apiKey: ApiKeyResponseDto;
    /** Creation date */
    createdAt: string;
    /** API key ID */
    id: string;
    /** API key name */
    name: string;
    /** List of permissions */
    permissions: Permission[];
    /** API key secret (only shown once) */
    secret: string;
    /** Last update date */
    updatedAt: string;
};
export type ApiKeyUpdateDto = {
    /** API key name */
    name?: string;
    /** List of permissions */
    permissions?: Permission[];
};
export type ArtJobCreateDto = {
    /** Photo to transform */
    assetId: string;
    /** Caption for styles that render one */
    caption?: string;
    /** Custom art direction; replaces the style prompt. `{caption}` is replaced with the caption */
    prompt?: string;
    /** Style ID, see the art styles endpoint */
    style?: string;
};
export type ArtJobResponseDto = {
    /** Caption */
    caption: string | null;
    /** Creation date */
    createdAt: string;
    /** Why the job failed */
    error: string | null;
    /** Job ID */
    id: string;
    /** Generated artwork, once the job completed */
    resultAssetId: string | null;
    /** Photo that is transformed */
    sourceAssetId: string;
    status: ArtJobStatus;
    /** Style ID */
    style: string | null;
    /** Last update date */
    updatedAt: string;
};
export type ArtStyleDto = {
    /** What the style looks like */
    description: string;
    /** Style ID */
    id: string;
    /** Style name */
    name: string;
    /** Whether the style renders a caption into the image */
    usesCaption: boolean;
};
export type AssetFileResponseDto = {
    /** Creation date */
    createdAt: string;
    /** Asset file ID */
    id: string;
    /** The file was generated from an edit */
    isEdited: boolean;
    /** The file is a progressively encoded JPEG */
    isProgressive: boolean;
    /** The file is transparent */
    isTransparent: boolean;
    /** File path */
    path: string;
    "type": AssetFileType;
    /** Update date */
    updatedAt: string;
};
export type AssetBulkDeleteDto = {
    /** Force delete even if in use */
    force?: boolean;
    /** IDs to process */
    ids: string[];
};
export type AssetMetadataUpsertItemDto = {
    /** Metadata key */
    key: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type AssetMediaCreateDto = {
    /** Asset file data */
    assetData: Blob;
    /** Duration in milliseconds (for videos) */
    duration?: number;
    /** File creation date */
    fileCreatedAt: string;
    /** File modification date */
    fileModifiedAt: string;
    /** Filename */
    filename?: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Live photo video ID */
    livePhotoVideoId?: string;
    /** Asset metadata items */
    metadata?: AssetMetadataUpsertItemDto[];
    /** Sidecar file data */
    sidecarData?: Blob;
    visibility?: AssetVisibility;
};
export type AssetMediaResponseDto = {
    /** Asset media ID */
    id: string;
    status: AssetMediaStatus;
};
export type AssetBulkUpdateDto = {
    /** Original date and time */
    dateTimeOriginal?: string;
    /** Relative time offset in minutes */
    dateTimeRelative?: number;
    /** Asset description */
    description?: string;
    /** Duplicate ID */
    duplicateId?: string | null;
    /** Asset IDs to update */
    ids: string[];
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Latitude coordinate */
    latitude?: number;
    /** Longitude coordinate */
    longitude?: number;
    /** Rating in range [1-5] (starred), -1 (rejected), or null (unrated) */
    rating?: number | null;
    /** Time zone (IANA timezone) */
    timeZone?: string;
    visibility?: AssetVisibility;
};
export type AssetBulkUploadCheckItem = {
    /** Base64 or hex encoded SHA1 hash */
    checksum: string;
    /** Client-side identifier echoed in the response to match results to inputs (e.g. filename) */
    id: string;
};
export type AssetBulkUploadCheckDto = {
    /** Assets to check */
    assets: AssetBulkUploadCheckItem[];
};
export type AssetBulkUploadCheckResult = {
    action: AssetUploadAction;
    /** Existing asset ID if duplicate */
    assetId?: string;
    /** Client-side identifier echoed from the request to match results to inputs */
    id: string;
    /** Whether existing asset is trashed */
    isTrashed?: boolean;
    reason?: AssetRejectReason;
};
export type AssetBulkUploadCheckResponseDto = {
    /** Upload check results */
    results: AssetBulkUploadCheckResult[];
};
export type AssetCopyDto = {
    /** Copy album associations */
    albums?: boolean;
    /** Copy favorite status */
    favorite?: boolean;
    /** Copy shared links */
    sharedLinks?: boolean;
    /** Copy sidecar file */
    sidecar?: boolean;
    /** Source asset ID */
    sourceId: string;
    /** Copy stack association */
    stack?: boolean;
    /** Target asset ID */
    targetId: string;
};
export type AssetJobsDto = {
    /** Asset IDs */
    assetIds: string[];
    name: AssetJobName;
};
export type AssetMetadataBulkDeleteItemDto = {
    /** Asset ID */
    assetId: string;
    /** Metadata key */
    key: string;
};
export type AssetMetadataBulkDeleteDto = {
    /** Metadata items to delete */
    items: AssetMetadataBulkDeleteItemDto[];
};
export type AssetMetadataBulkUpsertItemDto = {
    /** Asset ID */
    assetId: string;
    /** Metadata key */
    key: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type AssetMetadataBulkUpsertDto = {
    /** Metadata items to upsert */
    items: AssetMetadataBulkUpsertItemDto[];
};
export type AssetMetadataBulkResponseDto = {
    /** Asset ID */
    assetId: string;
    /** Metadata key */
    key: string;
    /** Last update date */
    updatedAt: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type ExifResponseDto = {
    /** City name */
    city?: string | null;
    /** Country name */
    country?: string | null;
    /** Original date/time */
    dateTimeOriginal?: string | null;
    /** Image description */
    description?: string | null;
    /** Image height in pixels */
    exifImageHeight?: number | null;
    /** Image width in pixels */
    exifImageWidth?: number | null;
    /** Exposure time */
    exposureTime?: string | null;
    /** F-number (aperture) */
    fNumber?: number | null;
    /** File size in bytes */
    fileSizeInByte?: number | null;
    /** Focal length in mm */
    focalLength?: number | null;
    /** ISO sensitivity */
    iso?: number | null;
    /** GPS latitude */
    latitude?: number | null;
    /** Lens model */
    lensModel?: string | null;
    /** GPS longitude */
    longitude?: number | null;
    /** Camera make */
    make?: string | null;
    /** Camera model */
    model?: string | null;
    /** Modification date/time */
    modifyDate?: string | null;
    /** Image orientation */
    orientation?: string | null;
    /** Projection type */
    projectionType?: string | null;
    /** Rating */
    rating?: number | null;
    /** State/province name */
    state?: string | null;
    /** Time zone */
    timeZone?: string | null;
};
export type PersonResponseDto = {
    /** Person date of birth */
    birthDate: string | null;
    /** Person color (hex) */
    color?: string;
    /** Person ID */
    id: string;
    /** Is favorite */
    isFavorite?: boolean;
    /** Is hidden */
    isHidden: boolean;
    /** Person name */
    name: string;
    /** Thumbnail path */
    thumbnailPath: string;
    /** Last update date */
    updatedAt?: string;
};
export type AssetStackResponseDto = {
    /** Number of assets in stack */
    assetCount: number;
    /** Stack ID */
    id: string;
    /** Primary asset ID */
    primaryAssetId: string;
};
export type TagResponseDto = {
    /** Tag color (hex) */
    color?: string;
    /** Creation date */
    createdAt: string;
    /** Tag ID */
    id: string;
    /** Tag name */
    name: string;
    /** Parent tag ID */
    parentId?: string;
    /** Last update date */
    updatedAt: string;
    /** Tag value (full path) */
    value: string;
};
export type AssetResponseDto = {
    /** Base64 encoded SHA1 hash */
    checksum: string;
    /** The UTC timestamp when the asset was originally uploaded to Immich. */
    createdAt: string;
    /** Duplicate group ID */
    duplicateId?: string | null;
    /** Video/gif duration in milliseconds (null for static images) */
    duration: number | null;
    exifInfo?: ExifResponseDto;
    /** The actual UTC timestamp when the file was created/captured, preserving timezone information. This is the authoritative timestamp for chronological sorting within timeline groups. Combined with timezone data, this can be used to determine the exact moment the photo was taken. */
    fileCreatedAt: string;
    /** The UTC timestamp when the file was last modified on the filesystem. This reflects the last time the physical file was changed, which may be different from when the photo was originally taken. */
    fileModifiedAt: string;
    /** Whether asset has metadata */
    hasMetadata: boolean;
    /** Asset height */
    height: number | null;
    /** Asset ID */
    id: string;
    /** Is archived */
    isArchived: boolean;
    /** Is edited */
    isEdited: boolean;
    /** Is favorite */
    isFavorite: boolean;
    /** Is offline */
    isOffline: boolean;
    /** Is trashed */
    isTrashed: boolean;
    /** Library ID */
    libraryId?: string | null;
    /** Live photo video ID */
    livePhotoVideoId?: string | null;
    /** The local date and time when the photo/video was taken, derived from EXIF metadata. This represents the photographer's local time regardless of timezone, stored as a timezone-agnostic timestamp. Used for timeline grouping by "local" days and months. */
    localDateTime: string;
    /** Original file name */
    originalFileName: string;
    /** Original MIME type */
    originalMimeType?: string;
    /** Original file path */
    originalPath: string;
    owner?: UserResponseDto;
    /** Owner user ID */
    ownerId: string;
    people?: PersonResponseDto[];
    /** Is resized */
    resized?: boolean;
    stack?: (AssetStackResponseDto) | null;
    tags?: TagResponseDto[];
    /** Thumbhash for thumbnail generation (base64) also used as the c query param for thumbnail cache busting. */
    thumbhash: string | null;
    "type": AssetTypeEnum;
    /** The UTC timestamp when the asset record was last updated in the database. This is automatically maintained by the database and reflects when any field in the asset was last modified. */
    updatedAt: string;
    visibility: AssetVisibility;
    /** Asset width */
    width: number | null;
};
export type UpdateAssetDto = {
    /** Original date and time */
    dateTimeOriginal?: string;
    /** Asset description */
    description?: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Latitude coordinate */
    latitude?: number;
    /** Live photo video ID */
    livePhotoVideoId?: string | null;
    /** Longitude coordinate */
    longitude?: number;
    /** Rating in range [1-5] (starred), -1 (rejected), or null (unrated) */
    rating?: number | null;
    visibility?: AssetVisibility;
};
export type CropParameters = {
    /** Height of the crop */
    height: number;
    /** Width of the crop */
    width: number;
    /** Top-Left X coordinate of crop */
    x: number;
    /** Top-Left Y coordinate of crop */
    y: number;
};
export type RotateParameters = {
    /** Rotation angle in degrees */
    angle: number;
};
export type MirrorParameters = {
    axis: MirrorAxis;
};
export type AssetEditActionItemResponseDto = {
    action: AssetEditAction;
    /** Asset edit ID */
    id: string;
    /** List of edit actions to apply (crop, rotate, or mirror) */
    parameters: CropParameters | RotateParameters | MirrorParameters;
};
export type AssetEditsResponseDto = {
    /** Asset ID these edits belong to */
    assetId: string;
    /** List of edit actions applied to the asset */
    edits: AssetEditActionItemResponseDto[];
};
export type AssetEditActionItemDto = {
    action: AssetEditAction;
    /** List of edit actions to apply (crop, rotate, or mirror) */
    parameters: CropParameters | RotateParameters | MirrorParameters;
};
export type AssetEditsCreateDto = {
    /** List of edit actions to apply (crop, rotate, or mirror) */
    edits: AssetEditActionItemDto[];
};
export type EnhanceDto = {
    /** Only consider these corrections */
    only?: EnhanceCorrectionType[];
    /** How strongly to correct the photo (default normal) */
    strength?: EnhanceStrength;
};
export type EnhanceResponseDto = {
    /** Human-readable list of the corrections */
    adjustments: string[];
    /** An identical enhanced copy already existed and was returned instead */
    duplicate: boolean;
    /** ID of the enhanced copy */
    id: string;
    /** ID of the original */
    sourceId: string;
};
export type EnhancePreviewDto = {
    /** Only consider these corrections */
    only?: EnhanceCorrectionType[];
    /** How strongly to correct the photo (default normal) */
    strength?: EnhanceStrength;
};
export type EnhanceCorrectionDto = {
    /** How strong the correction is, 0-1 */
    amount: number;
    /** What the correction does */
    description: string;
    /** Why it is applied */
    reason: string;
    "type": EnhanceCorrectionType;
};
export type EnhancePlanDto = {
    /** Noise reduction */
    denoise?: {
        /** Median filter size */
        size: number;
    };
    /** Gamma correction */
    exposure?: {
        /** Gamma: above 1 brightens the midtones, below 1 darkens them */
        gamma: number;
    };
    /** Stretch of the tonal range */
    levels?: {
        /** Input value (0-255) that becomes black */
        black: number;
        /** Input value (0-255) that becomes white */
        white: number;
    };
    /** Contrast-limited adaptive histogram equalization (CLAHE) of the brightness */
    localContrast?: {
        /** Blend with the original, 0-1 */
        amount: number;
        /** Contrast limit */
        clipLimit: number;
        /** Number of tiles along each side */
        grid: number;
    };
    /** Saturation boost */
    saturation?: {
        /** Saturation multiplier */
        factor: number;
    };
    /** Unsharp mask */
    sharpen?: {
        /** Sharpening of flat areas */
        m1: number;
        /** Sharpening of edges */
        m2: number;
        /** Radius of the unsharp mask */
        sigma: number;
    };
    /** Per-channel multipliers */
    whiteBalance?: {
        /** Blue multiplier */
        b: number;
        /** Green multiplier */
        g: number;
        /** Red multiplier */
        r: number;
    };
};
export type EnhanceAnalysisResponseDto = {
    /** Human-readable list of the corrections */
    adjustments: string[];
    /** Asset ID */
    assetId: string;
    /** The corrections, in the order they are applied */
    corrections: EnhanceCorrectionDto[];
    /** Whether the photo would change noticeably */
    needed: boolean;
    /** Corrections that were considered and skipped, and why */
    notes: string[];
    plan: EnhancePlanDto;
    strength: EnhanceStrength;
};
export type AssetMetadataResponseDto = {
    /** Metadata key */
    key: string;
    /** Last update date */
    updatedAt: string;
    /** Metadata value (object) */
    value: {
        [key: string]: any;
    };
};
export type AssetMetadataUpsertDto = {
    /** Metadata items to upsert */
    items: AssetMetadataUpsertItemDto[];
};
export type AssetOcrResponseDto = {
    assetId: string;
    /** Confidence score for text detection box */
    boxScore: number;
    id: string;
    /** Recognized text */
    text: string;
    /** Confidence score for text recognition */
    textScore: number;
    /** Normalized x coordinate of box corner 1 (0-1) */
    x1: number;
    /** Normalized x coordinate of box corner 2 (0-1) */
    x2: number;
    /** Normalized x coordinate of box corner 3 (0-1) */
    x3: number;
    /** Normalized x coordinate of box corner 4 (0-1) */
    x4: number;
    /** Normalized y coordinate of box corner 1 (0-1) */
    y1: number;
    /** Normalized y coordinate of box corner 2 (0-1) */
    y2: number;
    /** Normalized y coordinate of box corner 3 (0-1) */
    y3: number;
    /** Normalized y coordinate of box corner 4 (0-1) */
    y4: number;
};
export type SignUpDto = {
    /** User email */
    email: string;
    /** User name */
    name: string;
    /** User password */
    password: string;
};
export type ChangePasswordDto = {
    /** Invalidate all other sessions */
    invalidateSessions?: boolean;
    /** New password (min 8 characters) */
    newPassword: string;
    /** Current password */
    password: string;
};
export type LoginCredentialDto = {
    /** User email */
    email: string;
    /** User password */
    password: string;
};
export type LoginResponseDto = {
    /** Access token */
    accessToken: string;
    /** Is admin user */
    isAdmin: boolean;
    /** Is onboarded */
    isOnboarded: boolean;
    /** User name */
    name: string;
    /** Profile image path */
    profileImagePath: string;
    /** Should change password */
    shouldChangePassword: boolean;
    /** User email */
    userEmail: string;
    /** User ID */
    userId: string;
};
export type LogoutResponseDto = {
    /** Redirect URI */
    redirectUri: string;
    /** Logout successful */
    successful: boolean;
};
export type PinCodeResetDto = {
    /** User password (required if PIN code is not provided) */
    password?: string;
    /** New PIN code (4-6 digits) */
    pinCode?: string;
};
export type PinCodeSetupDto = {
    /** PIN code (4-6 digits) */
    pinCode: string;
};
export type PinCodeChangeDto = {
    /** New PIN code (4-6 digits) */
    newPinCode: string;
    /** User password (required if PIN code is not provided) */
    password?: string;
    /** New PIN code (4-6 digits) */
    pinCode?: string;
};
export type SessionUnlockDto = {
    /** User password (required if PIN code is not provided) */
    password?: string;
    /** New PIN code (4-6 digits) */
    pinCode?: string;
};
export type AuthStatusResponseDto = {
    /** Session expiration date */
    expiresAt?: string;
    /** Is elevated session */
    isElevated: boolean;
    /** Has password set */
    password: boolean;
    /** Has PIN code set */
    pinCode: boolean;
    /** PIN expiration date */
    pinExpiresAt?: string;
};
export type ValidateAccessTokenResponseDto = {
    /** Authentication status */
    authStatus: boolean;
};
export type BookStyle = {
    /** Color of the rules, ornaments and small-caps lines of the food theme (hex) */
    accentColor?: string;
    /** Page background color (hex) */
    background: string;
    /** Caption font size in points */
    captionSizePt?: number;
    /** Font family used for captions and titles */
    fontFamily: string;
    /** Space between photos in millimeters */
    gutterMm: number;
    /** Outer page margin in millimeters */
    marginMm: number;
    /** Caption and title color (hex) */
    textColor: string;
    theme?: BookStyleTheme;
    /** Title font size in points */
    titleSizePt?: number;
};
export type BookResponseDto = {
    /** Album the book is made from */
    albumId: string | null;
    /** Cover asset ID */
    coverAssetId: string | null;
    /** Creation date */
    createdAt: string;
    /** Whether the book changed after the PDF was exported */
    exportStale: boolean;
    /** Status of the PDF export */
    exportStatus: (BookExportStatus) | null;
    /** When the PDF export last completed */
    exportedAt: string | null;
    /** ID of the first page, e.g. to show the cover */
    firstPageId: string | null;
    /** Whether the book changed after the HTML file was exported */
    htmlExportStale: boolean;
    /** Status of the single-file HTML export */
    htmlExportStatus: (BookExportStatus) | null;
    /** When the HTML export last completed */
    htmlExportedAt: string | null;
    /** Book ID */
    id: string;
    /** Owner user ID */
    ownerId: string;
    /** Number of pages */
    pageCount: number;
    /** Page height in millimeters */
    pageHeightMm: number;
    /** Page width in millimeters */
    pageWidthMm: number;
    style: BookStyle;
    /** Book subtitle */
    subtitle: string | null;
    /** Book title */
    title: string;
    /** Last update date */
    updatedAt: string;
};
export type BookStyleUpdate = {
    /** Color of the rules, ornaments and small-caps lines of the food theme (hex) */
    accentColor?: string;
    /** Page background color (hex) */
    background?: string;
    /** Caption font size in points */
    captionSizePt?: number;
    /** Font family used for captions and titles */
    fontFamily?: string;
    /** Space between photos in millimeters */
    gutterMm?: number;
    /** Outer page margin in millimeters */
    marginMm?: number;
    /** Caption and title color (hex) */
    textColor?: string;
    theme?: BookStyleTheme;
    /** Title font size in points */
    titleSizePt?: number;
};
export type BookCreateDto = {
    /** Album the book is made from */
    albumId?: string | null;
    /** Page height in millimeters (default 210) */
    pageHeightMm?: number;
    /** Page width in millimeters (default 210) */
    pageWidthMm?: number;
    style?: BookStyleUpdate;
    stylePreset?: BookStylePreset;
    /** Book subtitle */
    subtitle?: string | null;
    /** Book title */
    title: string;
};
export type BookMapDto = {
    /** Art job that redraws the map as an illustration */
    artJobId?: string;
    /** Photos whose locations are plotted; defaults to the photos of the section that follows the map */
    assetIds?: string[];
    /** Illustrated map drawn instead of the rendered map */
    illustratedAssetId?: string;
    /** Label the places */
    labels: boolean;
    /** Connect the locations in time order */
    showRoute: boolean;
    style: BookMapStyle;
    /** Title drawn on the map */
    title?: string;
};
export type NormalizedRect = {
    /** Height, as a fraction of the image height */
    height: number;
    /** Width, as a fraction of the image width */
    width: number;
    /** Left edge, as a fraction of the image width */
    x: number;
    /** Top edge, as a fraction of the image height */
    y: number;
};
export type BookSlotResponseDto = {
    /** Width / height of the slot on the page */
    aspectRatio: number;
    /** Placed asset, null when the slot is empty */
    assetId: string | null;
    /** Photo caption */
    caption: string | null;
    /** Crop of the placed asset */
    crop: (NormalizedRect) | null;
    /** Zero-based slot index */
    slot: number;
};
export type BookPageResponseDto = {
    /** Page background color override */
    background: string | null;
    /** Page caption */
    caption: string | null;
    /** Page ID */
    id: string;
    /** Layout ID */
    layout: string;
    map: (BookMapDto) | null;
    /** Zero-based position of the page in the book */
    position: number;
    /** Section title */
    sectionTitle: string | null;
    /** Photo slots of the layout */
    slots: BookSlotResponseDto[];
    /** Last update date */
    updatedAt: string;
};
export type BookDetailResponseDto = {
    /** Album the book is made from */
    albumId: string | null;
    /** Cover asset ID */
    coverAssetId: string | null;
    /** Creation date */
    createdAt: string;
    /** Whether the book changed after the PDF was exported */
    exportStale: boolean;
    /** Status of the PDF export */
    exportStatus: (BookExportStatus) | null;
    /** When the PDF export last completed */
    exportedAt: string | null;
    /** ID of the first page, e.g. to show the cover */
    firstPageId: string | null;
    /** Whether the book changed after the HTML file was exported */
    htmlExportStale: boolean;
    /** Status of the single-file HTML export */
    htmlExportStatus: (BookExportStatus) | null;
    /** When the HTML export last completed */
    htmlExportedAt: string | null;
    /** Book ID */
    id: string;
    /** Owner user ID */
    ownerId: string;
    /** Number of pages */
    pageCount: number;
    /** Page height in millimeters */
    pageHeightMm: number;
    /** Page width in millimeters */
    pageWidthMm: number;
    /** Pages in book order */
    pages: BookPageResponseDto[];
    style: BookStyle;
    /** Book subtitle */
    subtitle: string | null;
    /** Book title */
    title: string;
    /** Last update date */
    updatedAt: string;
};
export type BookFromAlbumDto = {
    /** Album whose photos are laid out */
    albumId: string;
    captions?: BookCaptionMode;
    /** Pick the photos on what they can become after the fixes the app can make (straightening, auto-enhance), simulated on their previews (default true) */
    considerImprovements?: boolean;
    /** Also redraw every map as an illustration with the art agent (default false) */
    illustratedMaps?: boolean;
    /** Create improved copies (straightened, auto-enhanced) of the placed photos that a fix measurably helps, stacked with the originals, and place the copies instead (default false) */
    improvePhotos?: boolean;
    /** Open the sections that have GPS locations with a map page (default true) */
    includeMaps?: boolean;
    mapStyle?: BookMapStyleOption;
    /** Most pages with artwork, as a share of the pages (default 0.2); artwork is never on two pages in a row */
    maxArtworkShare?: number;
    /** Artworks shown next to their original on the same page (default 2) */
    maxStackPairs?: number;
    /** Page height in millimeters (default 210) */
    pageHeightMm?: number;
    /** Page width in millimeters (default 210) */
    pageWidthMm?: number;
    style?: BookStyleUpdate;
    stylePreset?: BookStylePreset;
    /** Book subtitle */
    subtitle?: string | null;
    /** Approximate number of pages (default: about one page per 2.5 photos, 4 to 80 pages) */
    targetPageCount?: number;
    /** Book title (default: the album name) */
    title?: string;
};
export type BookAutoLayoutResponseDto = {
    /** Album the book is made from */
    albumId: string | null;
    /** Cover asset ID */
    coverAssetId: string | null;
    /** Creation date */
    createdAt: string;
    /** Whether the book changed after the PDF was exported */
    exportStale: boolean;
    /** Status of the PDF export */
    exportStatus: (BookExportStatus) | null;
    /** When the PDF export last completed */
    exportedAt: string | null;
    /** ID of the first page, e.g. to show the cover */
    firstPageId: string | null;
    /** Whether the book changed after the HTML file was exported */
    htmlExportStale: boolean;
    /** Status of the single-file HTML export */
    htmlExportStatus: (BookExportStatus) | null;
    /** When the HTML export last completed */
    htmlExportedAt: string | null;
    /** Book ID */
    id: string;
    /** Owner user ID */
    ownerId: string;
    /** Number of pages */
    pageCount: number;
    /** Page height in millimeters */
    pageHeightMm: number;
    /** Page width in millimeters */
    pageWidthMm: number;
    /** Pages in book order */
    pages: BookPageResponseDto[];
    style: BookStyle;
    /** Book subtitle */
    subtitle: string | null;
    /** Book title */
    title: string;
    /** Last update date */
    updatedAt: string;
    /** Problems met while laying out the book, e.g. a map style that is not available */
    warnings: string[];
};
export type BookLayoutRect = {
    /** Height, as a fraction of the layout area */
    height: number;
    /** Width, as a fraction of the layout area */
    width: number;
    /** Left edge, as a fraction of the layout area */
    x: number;
    /** Top edge, as a fraction of the layout area */
    y: number;
};
export type BookLayoutResponseDto = {
    /** Layout description */
    description: string;
    /** Whether the layout is made for food books (menu pages, dishes with their names) */
    food: boolean;
    /** Whether the layout ignores the page margins */
    fullBleed: boolean;
    /** Layout ID */
    id: string;
    /** Area of the page map, relative to the area inside the margins */
    mapArea?: BookLayoutRect;
    /** Layout name */
    name: string;
    /** Preferred photo orientation */
    orientation: Orientation;
    /** Photo slots, relative to the area inside the margins */
    slots: BookLayoutRect[];
    /** Text areas, relative to the area inside the margins */
    textAreas: {
        /** Height, as a fraction of the layout area */
        height: number;
        /** Text shown in the area; slotCaption is the caption of one photo, drawn beside it */
        kind: Kind2;
        /** Zero-based slot whose caption a slotCaption area shows */
        slot?: number;
        /** Width, as a fraction of the layout area */
        width: number;
        /** Left edge, as a fraction of the layout area */
        x: number;
        /** Top edge, as a fraction of the layout area */
        y: number;
    }[];
};
export type BookStylePresetResponseDto = {
    /** Preset description */
    description: string;
    id: BookStylePreset;
    /** Preset name */
    name: string;
    style: BookStyle;
};
export type BookUpdateDto = {
    /** Album the book is made from */
    albumId?: string | null;
    /** Asset shown on the cover when its slot is empty */
    coverAssetId?: string | null;
    /** Page height in millimeters */
    pageHeightMm?: number;
    /** Page width in millimeters */
    pageWidthMm?: number;
    style?: BookStyleUpdate;
    /** Replace the style with a preset (see GET /books/style-presets); style overrides its values */
    stylePreset?: BookStylePreset;
    /** Book subtitle */
    subtitle?: string | null;
    /** Book title */
    title?: string;
};
export type BookAutoLayoutDto = {
    /** Photos to lay out (default: the photos of the book's album) */
    assetIds?: string[];
    captions?: BookCaptionMode;
    /** Pick the photos on what they can become after the fixes the app can make (straightening, auto-enhance), simulated on their previews (default true) */
    considerImprovements?: boolean;
    /** Photos that get a page of their own */
    heroAssetIds?: string[];
    /** Also redraw every map as an illustration with the art agent (default false) */
    illustratedMaps?: boolean;
    /** Create improved copies (straightened, auto-enhanced) of the placed photos that a fix measurably helps, stacked with the originals, and place the copies instead (default false) */
    improvePhotos?: boolean;
    /** Open the sections that have GPS locations with a map page (default true) */
    includeMaps?: boolean;
    /** Append the new pages to the existing ones instead of replacing them (default false) */
    keepExisting?: boolean;
    mapStyle?: BookMapStyleOption;
    /** Most pages with artwork, as a share of the pages (default 0.2); artwork is never on two pages in a row */
    maxArtworkShare?: number;
    /** Artworks shown next to their original on the same page (default 2) */
    maxStackPairs?: number;
    /** Approximate number of pages (default: about one page per 2.5 photos, 4 to 80 pages) */
    targetPageCount?: number;
};
export type BookExportDto = {
    /** Export format (default pdf) */
    format?: BookExportFormat;
};
export type BookPageCreateDto = {
    /** Page background color, overriding the book style */
    background?: string | null;
    /** Page caption */
    caption?: string | null;
    /** Layout ID (see GET /books/layouts) */
    layout: string;
    map?: (BookMapDto) | null;
    /** Zero-based position to insert the page at; appended when omitted */
    position?: number;
    /** Section title */
    sectionTitle?: string | null;
};
export type BookPageUpdateDto = {
    /** Page background color, overriding the book style */
    background?: string | null;
    /** Page caption */
    caption?: string | null;
    /** Layout ID; photos in slots the new layout lacks are removed */
    layout?: string;
    map?: (BookMapDto) | null;
    /** Section title */
    sectionTitle?: string | null;
};
export type BookPageMoveDto = {
    /** New zero-based position of the page */
    position: number;
};
export type BookSlotPatchDto = {
    /** Photo caption */
    caption?: string | null;
    /** Crop of the placed asset */
    crop?: (NormalizedRect) | null;
};
export type BookSlotUpdateDto = {
    /** Asset to place in the slot */
    assetId: string;
    /** Photo caption */
    caption?: string | null;
    /** Crop of the asset; a default crop matching the slot is chosen when omitted */
    crop?: (NormalizedRect) | null;
};
export type BookReviewIssueDto = {
    /** Photos involved, or photos to use instead */
    assetIds?: string[];
    /** Print resolution of the placement */
    dpi?: number;
    /** What is wrong and how to fix it */
    message: string;
    /** One-based page numbers */
    pages: number[];
    /** How much the issue hurts the book */
    severity: Severity;
    /** One-based slot number */
    slot?: number;
    /** Kind of issue */
    "type": Type;
};
export type BookReviewSuggestionDto = {
    /** Photo ID */
    assetId: string;
    /** Place of the photo */
    city?: string;
    /** Named people in the photo */
    people?: string[];
    /** Quality score, 0..1 */
    score: number;
};
export type BookReviewPlacementDto = {
    /** Photo ID */
    assetId: string;
    /** One-based page number */
    page: number;
    /** Quality score, 0..1 */
    score: number;
    /** One-based slot number */
    slot: number;
};
export type BookReviewResponseDto = {
    /** Number of issues per severity */
    counts: {
        high: number;
        low: number;
        medium: number;
    };
    /** Issues, most severe first */
    issues: BookReviewIssueDto[];
    /** Number of pages */
    pageCount: number;
    /** The people who appear most often in the album */
    people: {
        /** Person name */
        name?: string;
        /** Person ID */
        personId: string;
        /** Photos of the person in the album */
        photos: number;
        /** Photos of the person in the book */
        placed: number;
    }[];
    /** The best photos of the album that are not in the book, photos of the main people first */
    unusedPhotos: BookReviewSuggestionDto[];
    /** The lowest scoring photos in the book */
    weakestPlaced: BookReviewPlacementDto[];
};
export type ClusterGroupRequestResponseDto = {
    /** Cluster group the user is invited to join */
    clusterGroupId: string;
    /** Creation date */
    createdAt: string;
    /** Request ID */
    id: string;
    /** User the request was created for */
    userId: string;
};
export type ClusterGroupRequestCreateDto = {
    /** User to invite into the cluster group */
    userId: string;
};
export type CollectionNamesDto = {
    /** Plural of entry */
    entries: string;
    /** An entry of the source, e.g. menu item */
    entry: string;
    /** The place of a visit, e.g. restaurant */
    place: string;
    /** The text-source photo, e.g. menu */
    source: string;
    /** Plural of source */
    sources: string;
    /** A photographed thing, e.g. dish */
    subject: string;
    /** Plural of subject */
    subjects: string;
    /** A visit, e.g. meal */
    visit: string;
    /** Plural of visit */
    visits: string;
};
export type CollectionPackResponseDto = {
    /** The book style preset of the pack */
    bookStylePreset: string;
    /** What the pack is for */
    description: string;
    /** Pack ID, e.g. food */
    id: string;
    names: CollectionNamesDto;
    /** Whether places can be looked up on OpenStreetMap when the admin enables it */
    placeLookup: boolean;
    /** The tag leaf that marks a source photo, e.g. Menu */
    sourceLeaf: string;
    /** First level of the tags of the pack, e.g. Food */
    tagRoot: string;
    /** Pack title, e.g. Food */
    title: string;
};
export type CollectionPlaceSummaryDto = {
    /** Local day of the last visit, e.g. 2016-03-23 */
    last: string;
    /** Name of the place, as in the tags (redacted for packs that hide private text) */
    name: string;
    /** Visits of the place */
    visits: number;
};
export type CollectionPackSummaryDto = {
    /** Distinct entries of the places, e.g. dishes */
    entries: number;
    /** The word for the entries of the pack, e.g. menu items */
    entry: string;
    /** Local day of the first visit */
    first?: string;
    /** Local day of the last visit */
    last?: string;
    /** Pack ID, e.g. food */
    pack: string;
    /** Photos tagged with the pack */
    photos: number;
    /** The word for a place of the pack, e.g. restaurant */
    place: string;
    /** Distinct places */
    places: number;
    /** The places visited most recently, up to 5 */
    recentPlaces: CollectionPlaceSummaryDto[];
    /** Photos of the sources, e.g. menus */
    sources: number;
    /** Pack title, e.g. Food */
    title: string;
    /** The word for the visits of the pack, e.g. meals */
    visit: string;
    /** Visits: the photos of a place grouped by time */
    visits: number;
    /** Years with visits, in order */
    years: number[];
};
export type CollectionSummaryResponseDto = {
    /** Every pack, with zeros when it has no tagged photos */
    packs: CollectionPackSummaryDto[];
    /** Whether the library has more tagged photos than were read */
    truncated: boolean;
};
export type CollectionEntryNameDto = {
    /** Name of the entry; the source leaf (e.g. "menu") marks a source */
    entry?: string;
    /** Asset ID */
    id: string;
    /** The photo shows the source */
    source?: boolean;
};
export type CollectionEntriesDto = {
    /** The photos to name */
    photos: CollectionEntryNameDto[];
    /** Name of the place */
    place: string;
};
export type CollectionEntryResultDto = {
    /** The description set on the photo, when it had none */
    description?: string;
    /** Why the photo was not tagged */
    error?: string;
    /** Asset ID */
    id: string;
    /** Tags of the pack the photo had before, now removed */
    previousTags?: string[];
    /** Whether the photo was tagged */
    success: boolean;
    /** The tag of the photo */
    tag?: string;
};
export type CollectionEntriesResponseDto = {
    /** Name of the place as it is used in the tags */
    place: string;
    /** One result per photo */
    results: CollectionEntryResultDto[];
};
export type CollectionEntryInputDto = {
    /** Description of the entry */
    description?: string;
    /** Name of the entry, as printed */
    name: string;
};
export type CollectionMatchDto = {
    /** Entries to match instead of the ones read on the source photos */
    entries?: CollectionEntryInputDto[];
    /** Photos of the source of the visit */
    sourceIds?: string[];
    /** Photos of the subjects of one visit */
    subjectIds: string[];
};
export type CollectionEntryDto = {
    /** Description of the entry */
    description?: string;
    /** Index of the entry */
    index: number;
    /** Name of the entry, as printed */
    name: string;
    /** Price as printed */
    price?: string;
    /** Section of the source, e.g. "Primi piatti" */
    section?: string;
    /** Source photo the entry was read on */
    sourceId?: string;
};
export type CollectionSuggestionDto = {
    /** Index of the entry */
    index: number;
    /** Name of the entry */
    name: string;
    /** Probability among the entries, 0-1 */
    score: number;
};
export type CollectionSubjectMatchDto = {
    /** Photos of the same subject */
    assetIds: string[];
    /** Index of the matched entry */
    index?: number;
    /** Name of the matched entry */
    name?: string;
    /** Probability that the subject is not an entry of the source, 0-1 */
    offList?: number;
    /** Probability of the match, 0-1 */
    score: number;
    /** The entry is matched to other subjects too */
    shared?: boolean;
    /** Best entries for the photos */
    suggestions: CollectionSuggestionDto[];
    /** The match is weak or not the favourite of the photos: check it */
    unsure: boolean;
};
export type CollectionMatchResponseDto = {
    /** The entries */
    entries: CollectionEntryDto[];
    /** Subject photos that could not be matched because smart search has not run */
    noEmbedding: string[];
    /** The subjects were matched in the order of the source; the scores are over all such alignments */
    ordered?: boolean;
    /** The subjects, with their matches */
    subjects: CollectionSubjectMatchDto[];
    /** Why matching may be incomplete */
    warnings: string[];
};
export type CollectionVisitsDto = {
    /** Find visits among the photos of this album */
    albumId?: string;
    /** Find visits among these photos */
    assetIds?: string[];
    /** A photo further from the place of the visit starts a new visit */
    maxDistanceMeters?: number;
    /** A longer gap between photos starts a new visit */
    maxGapMinutes?: number;
    /** Only photos taken after this date (ISO 8601) */
    takenAfter?: string;
    /** Only photos taken before this date (ISO 8601) */
    takenBefore?: string;
};
export type CollectionPlaceCandidateDto = {
    /** Photos the name was read on */
    assetIds: string[];
    /** Confidence, 0-1 */
    confidence: number;
    /** Place name */
    name: string;
    source: CollectionPlaceSource;
};
export type CollectionSavedEntryDto = {
    /** Asset ID */
    assetId: string;
    /** Entry of the tag, absent for a source photo */
    entry?: string;
    /** Place of the tag */
    place: string;
    /** Whether the photo is tagged as the source */
    source: boolean;
};
export type CollectionVisitResponseDto = {
    /** Other names read on the photos */
    candidates: CollectionPlaceCandidateDto[];
    /** City */
    city?: string;
    /** Country */
    country?: string;
    /** Local day of the visit */
    day: string;
    /** Local date-time of the last photo */
    end: string;
    /** Position of the visit, in time order */
    index: number;
    /** Latitude of the visit (average of its located photos) */
    latitude?: number;
    /** Longitude of the visit (average of its located photos) */
    longitude?: number;
    /** The best name for the place */
    place: CollectionPlaceCandidateDto;
    /** Photos of a receipt or a ticket */
    receiptIds: string[];
    /** Tags of the pack already on the photos of the visit */
    saved: CollectionSavedEntryDto[];
    /** Photos of a sign of the place, e.g. a storefront */
    signIds: string[];
    /** Photos of the source, e.g. the menu */
    sourceIds: string[];
    /** Local date-time of the first photo */
    start: string;
    /** Photos of the subjects, e.g. dishes and drinks */
    subjectIds: string[];
    /** Kind of visit by local time, e.g. Lunch, for packs that have kinds */
    "type"?: string;
};
export type CollectionVisitsResponseDto = {
    /** Photos considered */
    count: number;
    /** Collection pack */
    pack: string;
    /** Photos found to belong to the collection: subjects, sources, signs and receipts */
    photos: number;
    /** Whether more than 5000 photos matched and the rest were left out */
    truncated: boolean;
    /** Visits, in time order */
    visits: CollectionVisitResponseDto[];
    /** Why the search may be incomplete, e.g. smart search is disabled */
    warnings: string[];
};
export type UserConfigFFmpegRealtimeDto = {
    /** Enable real-time HLS transcoding (alpha) */
    enabled: boolean;
    /** Resolutions to use for real-time HLS transcoding */
    resolutions: HlsVideoResolution[];
    /** Video codecs to use for real-time HLS transcoding */
    videoCodecs: VideoCodec[];
};
export type UserConfigFFmpegDto = {
    realtime: UserConfigFFmpegRealtimeDto;
};
export type UserConfigGeneratedFullsizeImageDto = {
    /** Enabled */
    enabled: boolean;
};
export type UserConfigGeneratedImageDto = {
    /** Size */
    size: number;
};
export type UserConfigImageDto = {
    fullsize: UserConfigGeneratedFullsizeImageDto;
    preview: UserConfigGeneratedImageDto;
    thumbnail: UserConfigGeneratedImageDto;
};
export type UserConfigClipDto = {
    /** Whether the task is enabled */
    enabled: boolean;
};
export type UserConfigDuplicateDetectionDto = {
    /** Whether the task is enabled */
    enabled: boolean;
};
export type UserConfigFacialRecognitionDto = {
    /** Whether the task is enabled */
    enabled: boolean;
    /** Minimum number of faces required for recognition */
    minFaces: number;
};
export type UserConfigOcrDto = {
    /** Whether the task is enabled */
    enabled: boolean;
};
export type UserConfigMachineLearningDto = {
    clip: UserConfigClipDto;
    duplicateDetection: UserConfigDuplicateDetectionDto;
    /** Enabled */
    enabled: boolean;
    facialRecognition: UserConfigFacialRecognitionDto;
    ocr: UserConfigOcrDto;
};
export type UserConfigMapDto = {
    /** Dark map style URL */
    darkStyle: string;
    /** Enabled */
    enabled: boolean;
    /** Light map style URL */
    lightStyle: string;
};
export type UserConfigOAuthDto = {
    /** Auto launch */
    autoLaunch: boolean;
    /** Button text */
    buttonText: string;
    /** Enabled */
    enabled: boolean;
};
export type UserConfigPasswordLoginDto = {
    /** Enabled */
    enabled: boolean;
};
export type UserConfigReverseGeocodingDto = {
    /** Enabled */
    enabled: boolean;
};
export type UserConfigServerDto = {
    /** External domain */
    externalDomain: string;
    /** Login page message */
    loginPageMessage: string;
    /** Public users */
    publicUsers: boolean;
};
export type UserConfigThemeDto = {
    /** Custom CSS for theming */
    customCss: string;
};
export type UserConfigTrashDto = {
    /** Days */
    days: number;
    /** Enabled */
    enabled: boolean;
};
export type UserConfigUserDto = {
    /** Delete delay */
    deleteDelay: number;
};
export type UserConfigDto = {
    ffmpeg: UserConfigFFmpegDto;
    image: UserConfigImageDto;
    machineLearning: UserConfigMachineLearningDto;
    map: UserConfigMapDto;
    oauth: UserConfigOAuthDto;
    passwordLogin: UserConfigPasswordLoginDto;
    reverseGeocoding: UserConfigReverseGeocodingDto;
    server: UserConfigServerDto;
    theme: UserConfigThemeDto;
    trash: UserConfigTrashDto;
    user: UserConfigUserDto;
};
export type DownloadArchiveDto = {
    /** The name of the archive to download, without extension */
    archiveName?: string;
    /** Asset IDs */
    assetIds: string[];
    /** Download edited asset if available */
    edited?: boolean;
};
export type DownloadInfoDto = {
    /** Album ID to download */
    albumId?: string;
    /** Archive size limit in bytes */
    archiveSize?: number;
    /** Asset IDs to download */
    assetIds?: string[];
    /** User ID to download assets from */
    userId?: string;
};
export type DownloadArchiveInfo = {
    /** Asset IDs in this archive */
    assetIds: string[];
    /** Archive size in bytes */
    size: number;
};
export type DownloadResponseDto = {
    /** Archive information */
    archives: DownloadArchiveInfo[];
    /** Total size in bytes */
    totalSize: number;
};
export type DuplicateResponseDto = {
    /** Duplicate assets */
    assets: AssetResponseDto[];
    /** Duplicate group ID */
    duplicateId: string;
    /** Suggested asset IDs to keep based on file size and EXIF data */
    suggestedKeepAssetIds: string[];
};
export type DuplicateResolveGroupDto = {
    duplicateId: string;
    /** Asset IDs to keep */
    keepAssetIds: string[];
    /** Asset IDs to trash or delete */
    trashAssetIds: string[];
};
export type DuplicateResolveDto = {
    /** List of duplicate groups to resolve */
    groups: DuplicateResolveGroupDto[];
};
export type AssetFaceResponseDto = {
    /** Bounding box X1 coordinate */
    boundingBoxX1: number;
    /** Bounding box X2 coordinate */
    boundingBoxX2: number;
    /** Bounding box Y1 coordinate */
    boundingBoxY1: number;
    /** Bounding box Y2 coordinate */
    boundingBoxY2: number;
    /** Face ID */
    id: string;
    /** Image height in pixels */
    imageHeight: number;
    /** Image width in pixels */
    imageWidth: number;
    person: (PersonResponseDto) | null;
    sourceType?: SourceType;
};
export type AssetFaceCreateDto = {
    /** Asset ID */
    assetId: string;
    /** Face bounding box height */
    height: number;
    /** Image height in pixels */
    imageHeight: number;
    /** Image width in pixels */
    imageWidth: number;
    /** Person ID */
    personId: string;
    /** Face bounding box width */
    width: number;
    /** Face bounding box X coordinate */
    x: number;
    /** Face bounding box Y coordinate */
    y: number;
};
export type AssetFaceDeleteDto = {
    /** Force delete even if person has other faces */
    force: boolean;
};
export type FaceDto = {
    /** Face ID */
    id: string;
};
export type FoodDishNameDto = {
    /** Name of the dish; "menu" marks a photo of the menu */
    dish?: string;
    /** Asset ID */
    id: string;
    /** The photo shows the menu */
    menu?: boolean;
};
export type FoodDishesDto = {
    /** The photos to name */
    photos: FoodDishNameDto[];
    /** Name of the restaurant */
    restaurant: string;
};
export type FoodDishResultDto = {
    /** The description set on the photo, when it had none */
    description?: string;
    /** Why the photo was not tagged */
    error?: string;
    /** Asset ID */
    id: string;
    /** Food tags the photo had before, now removed */
    previousTags?: string[];
    /** Whether the photo was tagged */
    success: boolean;
    /** The food tag of the photo */
    tag?: string;
};
export type FoodDishesResponseDto = {
    /** Name of the restaurant as it is used in the tags */
    restaurant: string;
    /** One result per photo */
    results: FoodDishResultDto[];
};
export type FoodMealsDto = {
    /** Find meals among the photos of this album */
    albumId?: string;
    /** Find meals among these photos */
    assetIds?: string[];
    /** A photo further from the place of the meal starts a new meal */
    maxDistanceMeters?: number;
    /** A longer gap between food photos starts a new meal */
    maxGapMinutes?: number;
    /** Only photos taken after this date (ISO 8601) */
    takenAfter?: string;
    /** Only photos taken before this date (ISO 8601) */
    takenBefore?: string;
};
export type FoodRestaurantCandidateDto = {
    /** Photos the name was read on */
    assetIds: string[];
    /** Confidence, 0-1 */
    confidence: number;
    /** Restaurant name */
    name: string;
    source: FoodRestaurantSource;
};
export type FoodSavedDishDto = {
    /** Asset ID */
    assetId: string;
    /** Dish of the food tag, absent for a menu */
    dish?: string;
    /** Whether the photo is tagged as the menu */
    menu: boolean;
    /** Restaurant of the food tag */
    restaurant: string;
};
export type FoodMealResponseDto = {
    /** Other names read on the photos */
    candidates: FoodRestaurantCandidateDto[];
    /** City */
    city?: string;
    /** Country */
    country?: string;
    /** Local day of the meal */
    day: string;
    /** Photos of dishes and drinks */
    dishIds: string[];
    /** Local date-time of the last photo */
    end: string;
    /** Position of the meal, in time order */
    index: number;
    /** Latitude of the meal (average of its located photos) */
    latitude?: number;
    /** Longitude of the meal (average of its located photos) */
    longitude?: number;
    /** Photos of the menu */
    menuIds: string[];
    /** Photos of the receipt */
    receiptIds: string[];
    /** The best name for the restaurant */
    restaurant: FoodRestaurantCandidateDto;
    /** Food tags already on the photos of the meal */
    saved: FoodSavedDishDto[];
    /** Photos of the restaurant sign or storefront */
    signIds: string[];
    /** Local date-time of the first photo */
    start: string;
    "type": FoodMealType;
};
export type FoodMealsResponseDto = {
    /** Photos considered */
    count: number;
    /** Photos found to show food, a menu, a restaurant sign or a receipt */
    foodPhotos: number;
    /** Restaurant visits, in time order */
    meals: FoodMealResponseDto[];
    /** Whether more than 5000 photos matched and the rest were left out */
    truncated: boolean;
    /** Why the search may be incomplete, e.g. smart search is disabled */
    warnings: string[];
};
export type FoodMenuItemInputDto = {
    /** Description of the item */
    description?: string;
    /** Name of the item, as printed */
    name: string;
};
export type FoodMatchDto = {
    /** Photos of the dishes of one meal */
    dishIds: string[];
    /** Menu items to match instead of the ones read on the menu photos */
    items?: FoodMenuItemInputDto[];
    /** Photos of the menu of the meal */
    menuIds?: string[];
};
export type FoodDishSuggestionDto = {
    /** Index of the menu item */
    index: number;
    /** Name of the menu item */
    name: string;
    /** Probability among the items, 0-1 */
    score: number;
};
export type FoodDishMatchDto = {
    /** Photos of the same dish */
    assetIds: string[];
    /** Index of the matched menu item */
    index?: number;
    /** Name of the matched menu item */
    name?: string;
    /** Probability that the dish is not on the menu (bread, coffee, an amuse-bouche), 0-1 */
    offMenu?: number;
    /** Probability of the match, 0-1 */
    score: number;
    /** The menu item is matched to other dishes too */
    shared?: boolean;
    /** Best menu items for the photos */
    suggestions: FoodDishSuggestionDto[];
    /** The match is weak or not the favourite of the photos: check it */
    unsure: boolean;
};
export type FoodMenuItemDto = {
    /** Description of the item */
    description?: string;
    /** Index of the item */
    index: number;
    /** Menu photo the item was read on */
    menuId?: string;
    /** Name of the item, as printed */
    name: string;
    /** Price as printed */
    price?: string;
    /** Section of the menu, e.g. "Primi piatti" */
    section?: string;
};
export type FoodMatchResponseDto = {
    /** The dishes, with their matches */
    dishes: FoodDishMatchDto[];
    /** The menu items */
    items: FoodMenuItemDto[];
    /** Dish photos that could not be matched because smart search has not run */
    noEmbedding: string[];
    /** The dishes were matched in the order of the courses of a tasting menu; the scores are then the probabilities over all such alignments */
    ordered?: boolean;
    /** Why matching may be incomplete */
    warnings: string[];
};
export type QueueStatisticsDto = {
    /** Number of active jobs */
    active: number;
    /** Number of completed jobs */
    completed: number;
    /** Number of delayed jobs */
    delayed: number;
    /** Number of failed jobs */
    failed: number;
    /** Number of paused jobs */
    paused: number;
    /** Number of waiting jobs */
    waiting: number;
};
export type QueueStatusLegacyDto = {
    /** Whether the queue is currently active (has running jobs) */
    isActive: boolean;
    /** Whether the queue is paused */
    isPaused: boolean;
};
export type QueueResponseLegacyDto = {
    jobCounts: QueueStatisticsDto;
    queueStatus: QueueStatusLegacyDto;
};
export type QueuesResponseLegacyDto = {
    backgroundTask: QueueResponseLegacyDto;
    backupDatabase: QueueResponseLegacyDto;
    duplicateDetection: QueueResponseLegacyDto;
    editor: QueueResponseLegacyDto;
    faceDetection: QueueResponseLegacyDto;
    facialRecognition: QueueResponseLegacyDto;
    integrityCheck: QueueResponseLegacyDto;
    library: QueueResponseLegacyDto;
    metadataExtraction: QueueResponseLegacyDto;
    migration: QueueResponseLegacyDto;
    notifications: QueueResponseLegacyDto;
    ocr: QueueResponseLegacyDto;
    search: QueueResponseLegacyDto;
    sidecar: QueueResponseLegacyDto;
    smartSearch: QueueResponseLegacyDto;
    storageTemplateMigration: QueueResponseLegacyDto;
    thumbnailGeneration: QueueResponseLegacyDto;
    videoConversion: QueueResponseLegacyDto;
    workflow: QueueResponseLegacyDto;
};
export type JobCreateDto = {
    name: ManualJobName;
};
export type QueueCommandDto = {
    command: QueueCommand;
    /** Force the command execution (if applicable) */
    force?: boolean;
};
export type LibraryResponseDto = {
    /** Number of assets */
    assetCount: number;
    /** Creation date */
    createdAt: string;
    /** Exclusion patterns */
    exclusionPatterns: string[];
    /** Library ID */
    id: string;
    /** Import paths */
    importPaths: string[];
    /** Library name */
    name: string;
    /** Owner user ID */
    ownerId: string;
    /** Last refresh date */
    refreshedAt: string | null;
    /** Last update date */
    updatedAt: string;
};
export type CreateLibraryDto = {
    /** Exclusion patterns (max 128) */
    exclusionPatterns?: string[];
    /** Import paths (max 128) */
    importPaths?: string[];
    /** Library name */
    name?: string;
    /** Owner user ID */
    ownerId: string;
};
export type UpdateLibraryDto = {
    /** Exclusion patterns (max 128) */
    exclusionPatterns?: string[];
    /** Import paths (max 128) */
    importPaths?: string[];
    /** Library name */
    name?: string;
};
export type LibraryStatsResponseDto = {
    /** Number of photos */
    photos: number;
    /** Total number of assets */
    total: number;
    /** Storage usage in bytes */
    usage: number;
    /** Number of videos */
    videos: number;
};
export type ValidateLibraryDto = {
    /** Exclusion patterns (max 128) */
    exclusionPatterns?: string[];
    /** Import paths to validate (max 128) */
    importPaths?: string[];
};
export type ValidateLibraryImportPathResponseDto = {
    /** Import path */
    importPath: string;
    /** Is valid */
    isValid: boolean;
    /** Validation message */
    message?: string;
};
export type ValidateLibraryResponseDto = {
    /** Validation results for import paths */
    importPaths?: ValidateLibraryImportPathResponseDto[];
};
export type MapReverseGeocodeResponseDto = {
    /** City name */
    city: string | null;
    /** Country name */
    country: string | null;
    /** State/Province name */
    state: string | null;
};
export type MemoryDataDto = {
    /** Person ID (birthday memories) */
    personId?: string;
    /** Name of the person when the memory was created (birthday memories) */
    personName?: string;
    /** Year of the memory */
    year: number;
};
export type MemoryResponseDto = {
    assets: AssetResponseDto[];
    /** Creation date */
    createdAt: string;
    data: MemoryDataDto;
    /** Deletion date */
    deletedAt?: string;
    /** Date when memory should be hidden */
    hideAt?: string;
    /** Memory ID */
    id: string;
    /** Is memory saved */
    isSaved: boolean;
    /** Memory date */
    memoryAt: string;
    /** Owner user ID */
    ownerId: string;
    /** Date when memory was seen */
    seenAt?: string;
    /** Date when memory should be shown */
    showAt?: string;
    "type": MemoryType;
    /** Last update date */
    updatedAt: string;
};
export type MemoryCreateDto = {
    /** Asset IDs to associate with memory */
    assetIds?: string[];
    data: MemoryDataDto;
    /** Date when memory should be hidden */
    hideAt?: string;
    /** Is memory saved */
    isSaved?: boolean;
    /** Memory date */
    memoryAt: string;
    /** Date when memory was seen */
    seenAt?: string;
    /** Date when memory should be shown */
    showAt?: string;
    "type": MemoryType;
};
export type MemoryStatisticsResponseDto = {
    /** Total number of memories */
    total: number;
};
export type MemoryUpdateDto = {
    /** Is memory saved */
    isSaved?: boolean;
    /** Memory date */
    memoryAt?: string;
    /** Date when memory was seen */
    seenAt?: string;
};
export type NotificationDeleteAllDto = {
    /** Notification IDs to delete */
    ids: string[];
};
export type NotificationUpdateAllDto = {
    /** Notification IDs to update */
    ids: string[];
    /** Date when notifications were read */
    readAt?: string | null;
};
export type NotificationUpdateDto = {
    /** Date when notification was read */
    readAt?: string | null;
};
export type OAuthConfigDto = {
    /** OAuth code challenge (PKCE) */
    codeChallenge?: string;
    /** OAuth redirect URI */
    redirectUri: string;
    /** OAuth state parameter */
    state?: string;
};
export type OAuthAuthorizeResponseDto = {
    /** OAuth authorization URL */
    url: string;
};
export type OAuthBackchannelLogoutDto = {
    /** OAuth logout token */
    logout_token: string;
};
export type OAuthCallbackDto = {
    /** OAuth code verifier (PKCE) */
    codeVerifier?: string;
    /** OAuth state parameter */
    state?: string;
    /** OAuth callback URL */
    url: string;
};
export type PartnerResponseDto = {
    avatarColor: UserAvatarColor;
    /** User email */
    email: string;
    /** User ID */
    id: string;
    /** Show in timeline */
    inTimeline?: boolean;
    /** User name */
    name: string;
    /** Profile change date */
    profileChangedAt: string;
    /** Profile image path */
    profileImagePath: string;
};
export type PartnerCreateDto = {
    /** User ID to share with */
    sharedWithId: string;
};
export type PartnerUpdateDto = {
    /** Show partner assets in timeline */
    inTimeline: boolean;
};
export type PeopleResponseDto = {
    /** Whether there are more pages */
    hasNextPage?: boolean;
    /** Number of hidden people */
    hidden: number;
    people: PersonResponseDto[];
    /** Total number of people */
    total: number;
};
export type PersonCreateDto = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person color (hex) */
    color?: string | null;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
};
export type PeopleUpdateItem = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person color (hex) */
    color?: string | null;
    /** Asset ID used for feature face thumbnail */
    featureFaceAssetId?: string;
    /** Person ID */
    id: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
};
export type PeopleUpdateDto = {
    /** People to update */
    people: PeopleUpdateItem[];
};
export type MergePersonDto = {
    /** Person IDs to merge */
    ids: string[];
};
export type PersonUpdateDto = {
    /** Person date of birth */
    birthDate?: string | null;
    /** Person color (hex) */
    color?: string | null;
    /** Asset ID used for feature face thumbnail */
    featureFaceAssetId?: string;
    /** Mark as favorite */
    isFavorite?: boolean;
    /** Person visibility (hidden) */
    isHidden?: boolean;
    /** Person name */
    name?: string;
};
export type AssetFaceUpdateItem = {
    /** Asset ID */
    assetId: string;
    /** Person ID */
    personId: string;
};
export type AssetFaceUpdateDto = {
    /** Face update items */
    data: AssetFaceUpdateItem[];
};
export type PersonStatisticsResponseDto = {
    /** Number of assets */
    assets: number;
};
export type PluginMethodResponseDto = {
    /** Description */
    description: string;
    hostFunctions: boolean;
    /** Key */
    key: string;
    /** Name */
    name: string;
    schema?: {};
    /** Title */
    title: string;
    /** Workflow types */
    types: WorkflowType[];
    /** Ui hints */
    uiHints: string[];
};
export type PluginResponseDto = {
    /** Plugin author */
    author: string;
    /** Creation date */
    createdAt: string;
    /** Plugin description */
    description: string;
    /** Plugin ID */
    id: string;
    /** Plugin methods */
    methods: PluginMethodResponseDto[];
    /** Plugin name */
    name: string;
    /** Plugin title */
    title: string;
    /** Last update date */
    updatedAt: string;
    /** Plugin version */
    version: string;
};
export type PluginTemplateStepResponseDto = {
    /** Step configuration */
    config: {
        [key: string]: any;
    } | null;
    /** Whether the step is enabled */
    enabled?: boolean;
    /** Step plugin method */
    method: string;
};
export type PluginTemplateResponseDto = {
    /** Template description */
    description: string;
    /** Template key (unique across all templates) */
    key: string;
    /** Workflow steps */
    steps: PluginTemplateStepResponseDto[];
    /** Template title */
    title: string;
    /** Workflow trigger */
    trigger: WorkflowTrigger;
    /** Ui hints, for example "smart-album" */
    uiHints: string[];
};
export type PublicConfigOAuthDto = {
    /** Auto launch */
    autoLaunch: boolean;
    /** Button text */
    buttonText: string;
    /** Enabled */
    enabled: boolean;
};
export type PublicConfigPasswordLoginDto = {
    /** Enabled */
    enabled: boolean;
};
export type PublicConfigServerDto = {
    /** Login page message */
    loginPageMessage: string;
};
export type PublicConfigThemeDto = {
    /** Custom CSS for theming */
    customCss: string;
};
export type PublicConfigDto = {
    oauth: PublicConfigOAuthDto;
    passwordLogin: PublicConfigPasswordLoginDto;
    server: PublicConfigServerDto;
    theme: PublicConfigThemeDto;
};
export type QueueResponseDto = {
    /** Whether the queue is paused */
    isPaused: boolean;
    name: QueueName;
    statistics: QueueStatisticsDto;
};
export type QueueUpdateDto = {
    /** Whether to pause the queue */
    isPaused?: boolean;
};
export type QueueDeleteDto = {
    /** If true, will also remove failed jobs from the queue. */
    failed?: boolean;
};
export type QueueJobResponseDto = {
    /** Job data payload */
    data: {
        [key: string]: any;
    };
    /** Job ID */
    id?: string;
    name: JobName;
    /** Job creation timestamp */
    timestamp: number;
};
export type SearchExploreItem = {
    data: AssetResponseDto;
    /** Explore value */
    value: string;
};
export type SearchExploreResponseDto = {
    /** Explore field name */
    fieldName: string;
    items: SearchExploreItem[];
};
export type IdsFilter = {
    all?: string[];
    "any"?: string[];
    none?: string[];
};
export type StringFilter = {
    eq?: string;
    "in"?: string[];
    ne?: string;
    notIn?: string[];
};
export type StringFilterNullable = {
    eq?: string | null;
    "in"?: string[];
    ne?: string | null;
    notIn?: string[];
};
export type DateFilter = {
    eq?: string;
    gt?: string;
    gte?: string;
    lt?: string;
    lte?: string;
    ne?: string;
};
export type StringPatternFilter = {
    endsWith?: string;
    eq?: string | null;
    "in"?: string[];
    like?: string;
    ne?: string | null;
    notIn?: string[];
    notLike?: string;
    startsWith?: string;
};
export type NumberFilter = {
    eq?: number;
    gt?: number;
    gte?: number;
    "in"?: number[];
    lt?: number;
    lte?: number;
    ne?: number;
    notIn?: number[];
};
export type BoolFilter = {
    eq: boolean;
};
export type IdFilter = {
    eq?: string;
    ne?: string;
};
export type IdFilterNullable = {
    eq?: string | null;
    ne?: string | null;
};
export type StringSimilarityFilter = {
    matches: string;
};
export type NumberFilterNullable = {
    eq?: number | null;
    gt?: number;
    gte?: number;
    "in"?: number[];
    lt?: number;
    lte?: number;
    ne?: number | null;
    notIn?: number[];
};
export type DateFilterNullable = {
    eq?: string | null;
    gt?: string;
    gte?: string;
    lt?: string;
    lte?: string;
    ne?: string | null;
};
export type EnumFilterAssetType = {
    eq?: AssetTypeEnum;
    "in"?: AssetTypeEnum[];
    ne?: AssetTypeEnum;
    notIn?: AssetTypeEnum[];
};
export type EnumFilterAssetVisibility = {
    eq?: AssetVisibility;
    "in"?: AssetVisibility[];
    ne?: AssetVisibility;
    notIn?: AssetVisibility[];
};
export type SearchFilterBranch = {
    albumIds?: IdsFilter;
    checksum?: StringFilter;
    city?: StringFilterNullable;
    country?: StringFilterNullable;
    createdAt?: DateFilter;
    description?: StringPatternFilter;
    encodedVideoPath?: StringFilter;
    fileSizeInBytes?: NumberFilter;
    hasAlbums?: BoolFilter;
    hasPeople?: BoolFilter;
    hasTags?: BoolFilter;
    id?: IdFilter;
    isEncoded?: BoolFilter;
    isFavorite?: BoolFilter;
    isMotion?: BoolFilter;
    isOffline?: BoolFilter;
    lensModel?: StringFilterNullable;
    libraryId?: IdFilterNullable;
    make?: StringFilterNullable;
    model?: StringFilterNullable;
    ocr?: StringSimilarityFilter;
    originalFileName?: StringPatternFilter;
    originalPath?: StringPatternFilter;
    personIds?: IdsFilter;
    rating?: NumberFilterNullable;
    state?: StringFilterNullable;
    tagIds?: IdsFilter;
    takenAt?: DateFilter;
    trashedAt?: DateFilterNullable;
    "type"?: EnumFilterAssetType;
    updatedAt?: DateFilter;
    visibility?: EnumFilterAssetVisibility;
};
export type SearchFilter = {
    albumIds?: IdsFilter;
    checksum?: StringFilter;
    city?: StringFilterNullable;
    country?: StringFilterNullable;
    createdAt?: DateFilter;
    description?: StringPatternFilter;
    encodedVideoPath?: StringFilter;
    fileSizeInBytes?: NumberFilter;
    hasAlbums?: BoolFilter;
    hasPeople?: BoolFilter;
    hasTags?: BoolFilter;
    id?: IdFilter;
    isEncoded?: BoolFilter;
    isFavorite?: BoolFilter;
    isMotion?: BoolFilter;
    isOffline?: BoolFilter;
    lensModel?: StringFilterNullable;
    libraryId?: IdFilterNullable;
    make?: StringFilterNullable;
    model?: StringFilterNullable;
    ocr?: StringSimilarityFilter;
    or?: SearchFilterBranch[];
    originalFileName?: StringPatternFilter;
    originalPath?: StringPatternFilter;
    personIds?: IdsFilter;
    rating?: NumberFilterNullable;
    state?: StringFilterNullable;
    tagIds?: IdsFilter;
    takenAt?: DateFilter;
    trashedAt?: DateFilterNullable;
    "type"?: EnumFilterAssetType;
    updatedAt?: DateFilter;
    visibility?: EnumFilterAssetVisibility;
};
export type SearchOrder = {
    direction?: AssetOrder;
    field?: SearchOrderField;
};
export type MetadataSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by file checksum */
    checksum?: string;
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    /** Cursor for the next page of results */
    cursor?: string;
    /** Filter by description text */
    description?: string;
    /** Filter by encoded video file path */
    encodedVideoPath?: string;
    filter?: SearchFilter;
    /** Filter by asset ID */
    id?: string;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Sort order */
    order?: AssetOrder;
    orderBy?: SearchOrder;
    /** Filter by original file name */
    originalFileName?: string;
    /** Filter by original file path */
    originalPath?: string;
    /** Page number */
    page?: number;
    /** Filter by person IDs */
    personIds?: string[];
    /** Filter by preview file path */
    previewPath?: string;
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Number of results to return */
    size?: number;
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by thumbnail file path */
    thumbnailPath?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include deleted assets */
    withDeleted?: boolean;
    /** Include EXIF data in response */
    withExif?: boolean;
    /** Include people data in response */
    withPeople?: boolean;
    /** Include stacked assets */
    withStacked?: boolean;
};
export type SearchFacetCountResponseDto = {
    /** Number of assets with this facet value */
    count: number;
    /** Facet value */
    value: string;
};
export type SearchFacetResponseDto = {
    counts: SearchFacetCountResponseDto[];
    /** Facet field name */
    fieldName: string;
};
export type SearchAlbumResponseDto = {
    /** Number of albums in this page */
    count: number;
    facets: SearchFacetResponseDto[];
    items: AlbumResponseDto[];
    /** Total number of matching albums */
    total: number;
};
export type SearchAssetResponseDto = {
    /** Number of assets in this page */
    count: number;
    facets: SearchFacetResponseDto[];
    items: AssetResponseDto[];
    /** Cursor for the next page of results */
    nextCursor: string | null;
    /** Next page token */
    nextPage: string | null;
    /** Total number of matching assets */
    total: number;
};
export type SearchResponseDto = {
    albums: SearchAlbumResponseDto;
    assets: SearchAssetResponseDto;
};
export type PlacesResponseDto = {
    /** Administrative level 1 name (state/province) */
    admin1name?: string;
    /** Administrative level 2 name (county/district) */
    admin2name?: string;
    /** Latitude coordinate */
    latitude: number;
    /** Longitude coordinate */
    longitude: number;
    /** Place name */
    name: string;
};
export type RandomSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    filter?: SearchFilter;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Filter by person IDs */
    personIds?: string[];
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Number of results to return */
    size?: number;
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include deleted assets */
    withDeleted?: boolean;
    /** Include EXIF data in response */
    withExif?: boolean;
    /** Include people data in response */
    withPeople?: boolean;
    /** Include stacked assets */
    withStacked?: boolean;
};
export type SmartSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    filter?: SearchFilter;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Search language code */
    language?: string;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Page number */
    page?: number;
    /** Filter by person IDs */
    personIds?: string[];
    /** Natural language search query */
    query?: string;
    /** Asset ID to use as search reference */
    queryAssetId?: string;
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Number of results to return */
    size?: number;
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
    /** Include deleted assets */
    withDeleted?: boolean;
    /** Include EXIF data in response */
    withExif?: boolean;
};
export type StatisticsSearchDto = {
    /** Filter by album IDs */
    albumIds?: string[];
    /** Filter by city name */
    city?: string | null;
    /** Filter by country name */
    country?: string | null;
    /** Filter by creation date (after) */
    createdAfter?: string;
    /** Filter by creation date (before) */
    createdBefore?: string;
    /** Filter by description text */
    description?: string;
    filter?: SearchFilter;
    /** Filter by encoded status */
    isEncoded?: boolean;
    /** Filter by favorite status */
    isFavorite?: boolean;
    /** Filter by motion photo status */
    isMotion?: boolean;
    /** Filter assets not in any album */
    isNotInAlbum?: boolean;
    /** Filter by offline status */
    isOffline?: boolean;
    /** Filter by lens model */
    lensModel?: string | null;
    /** Library ID to filter by */
    libraryId?: string | null;
    /** Filter by camera make */
    make?: string | null;
    /** Filter by camera model */
    model?: string | null;
    /** Filter by OCR text content */
    ocr?: string;
    /** Filter by person IDs */
    personIds?: string[];
    /** Filter by rating [1-5], or null for unrated */
    rating?: number | null;
    /** Filter by state/province name */
    state?: string | null;
    /** Filter by tag IDs */
    tagIds?: string[] | null;
    /** Filter by taken date (after) */
    takenAfter?: string;
    /** Filter by taken date (before) */
    takenBefore?: string;
    /** Filter by trash date (after) */
    trashedAfter?: string;
    /** Filter by trash date (before) */
    trashedBefore?: string;
    "type"?: AssetTypeEnum;
    /** Filter by update date (after) */
    updatedAfter?: string;
    /** Filter by update date (before) */
    updatedBefore?: string;
    visibility?: AssetVisibility;
};
export type SearchStatisticsResponseDto = {
    /** Total number of matching assets */
    total: number;
};
export type ServerAboutResponseDto = {
    /** Build identifier */
    build?: string;
    /** Build image name */
    buildImage?: string;
    /** Build image URL */
    buildImageUrl?: string;
    /** Build URL */
    buildUrl?: string;
    /** ExifTool version */
    exiftool?: string;
    /** FFmpeg version */
    ffmpeg?: string;
    /** ImageMagick version */
    imagemagick?: string;
    /** libvips version */
    libvips?: string;
    /** Whether the server is licensed */
    licensed: boolean;
    /** Node.js version */
    nodejs?: string;
    /** Repository name */
    repository?: string;
    /** Repository URL */
    repositoryUrl?: string;
    /** Source commit hash */
    sourceCommit?: string;
    /** Source reference (branch/tag) */
    sourceRef?: string;
    /** Source URL */
    sourceUrl?: string;
    /** Third-party bug/feature URL */
    thirdPartyBugFeatureUrl?: string;
    /** Third-party documentation URL */
    thirdPartyDocumentationUrl?: string;
    /** Third-party source URL */
    thirdPartySourceUrl?: string;
    /** Third-party support URL */
    thirdPartySupportUrl?: string;
    /** Server version */
    version: string;
    /** URL to version information */
    versionUrl: string;
};
export type ServerApkLinksDto = {
    /** APK download link for ARM64 v8a architecture */
    arm64v8a: string;
    /** APK download link for ARM EABI v7a architecture */
    armeabiv7a: string;
    /** APK download link for universal architecture */
    universal: string;
    /** APK download link for x86_64 architecture */
    x86_64: string;
};
export type ServerConfigDto = {
    /** External domain URL */
    externalDomain: string;
    /** Whether the server has been initialized */
    isInitialized: boolean;
    /** Whether the admin has completed onboarding */
    isOnboarded: boolean;
    /** Login page message */
    loginPageMessage: string;
    /** Whether maintenance mode is active */
    maintenanceMode: boolean;
    /** Map dark style URL */
    mapDarkStyleUrl: string;
    /** Map light style URL */
    mapLightStyleUrl: string;
    /** People min faces server default */
    minFaces: number;
    /** OAuth account management URL */
    oauthAccountManagementUrl?: string;
    /** OAuth button text */
    oauthButtonText: string;
    /** Whether public user registration is enabled */
    publicUsers: boolean;
    /** Number of days before trashed assets are permanently deleted */
    trashDays: number;
    /** Delay in days before deleted users are permanently removed */
    userDeleteDelay: number;
};
export type ServerFeaturesDto = {
    /** Whether AI artistic style transforms are enabled */
    artisticStyles: boolean;
    /** Whether the AI assistant is enabled */
    assistant: boolean;
    /** Whether config file is available */
    configFile: boolean;
    /** Whether duplicate detection is enabled */
    duplicateDetection: boolean;
    /** Whether email notifications are enabled */
    email: boolean;
    /** Whether facial recognition is enabled */
    facialRecognition: boolean;
    /** Whether face import is enabled */
    importFaces: boolean;
    /** Whether map feature is enabled */
    map: boolean;
    /** Whether OAuth is enabled */
    oauth: boolean;
    /** Whether OAuth auto-launch is enabled */
    oauthAutoLaunch: boolean;
    /** Whether OCR is enabled */
    ocr: boolean;
    /** Whether password login is enabled */
    passwordLogin: boolean;
    /** Whether real-time transcoding is enabled */
    realtimeTranscoding: boolean;
    /** Whether the assistant may look up restaurant names on OpenStreetMap, with the user's approval */
    restaurantLookup: boolean;
    /** Whether reverse geocoding is enabled */
    reverseGeocoding: boolean;
    /** Whether search is enabled */
    search: boolean;
    /** Whether sidecar files are supported */
    sidecar: boolean;
    /** Whether smart search is enabled */
    smartSearch: boolean;
    /** Whether trash feature is enabled */
    trash: boolean;
};
export type LicenseKeyDto = {
    /** Activation key */
    activationKey: string;
    /** License key (format: /^IM(SV|CL)(-[\dA-Za-z]{4}){8}$/) */
    licenseKey: string;
};
export type ServerMediaTypesResponseDto = {
    /** Supported image MIME types */
    image: string[];
    /** Supported sidecar MIME types */
    sidecar: string[];
    /** Supported video MIME types */
    video: string[];
};
export type ServerPingResponse = {
    res: string;
};
export type UsageByUserDto = {
    /** Number of photos */
    photos: number;
    /** User quota size in bytes (null if unlimited) */
    quotaSizeInBytes: number | null;
    /** Total storage usage in bytes */
    usage: number;
    /** Storage usage for photos in bytes */
    usagePhotos: number;
    /** Storage usage for videos in bytes */
    usageVideos: number;
    /** User ID */
    userId: string;
    /** User name */
    userName: string;
    /** Number of videos */
    videos: number;
};
export type ServerStatsResponseDto = {
    /** Total number of photos */
    photos: number;
    /** Total storage usage in bytes */
    usage: number;
    /** Array of usage for each user */
    usageByUser: UsageByUserDto[];
    /** Storage usage for photos in bytes */
    usagePhotos: number;
    /** Storage usage for videos in bytes */
    usageVideos: number;
    /** Total number of videos */
    videos: number;
};
export type ServerStorageResponseDto = {
    /** Available disk space (human-readable format) */
    diskAvailable: string;
    /** Available disk space in bytes */
    diskAvailableRaw: number;
    /** Total disk size (human-readable format) */
    diskSize: string;
    /** Total disk size in bytes */
    diskSizeRaw: number;
    /** Disk usage percentage (0-100) */
    diskUsagePercentage: number;
    /** Used disk space (human-readable format) */
    diskUse: string;
    /** Used disk space in bytes */
    diskUseRaw: number;
};
export type ServerVersionResponseDto = {
    /** Major version number */
    major: number;
    /** Minor version number */
    minor: number;
    /** Patch version number */
    patch: number;
    /** Pre-release version number */
    prerelease: number | null;
};
export type VersionCheckStateResponseDto = {
    /** Last check timestamp */
    checkedAt: string | null;
    /** Release version */
    releaseVersion: string | null;
};
export type ServerVersionHistoryResponseDto = {
    /** When this version was first seen */
    createdAt: string;
    /** Version history entry ID */
    id: string;
    /** Version string */
    version: string;
};
export type SessionCreateDto = {
    /** Device OS */
    deviceOS?: string;
    /** Device type */
    deviceType?: string;
    /** Session duration in seconds */
    duration?: number;
};
export type SessionCreateResponseDto = {
    /** App version */
    appVersion: string | null;
    /** Creation date */
    createdAt: string;
    /** Is current session */
    current: boolean;
    /** Device OS */
    deviceOS: string;
    /** Device type */
    deviceType: string;
    /** Expiration date */
    expiresAt?: string;
    /** Session ID */
    id: string;
    /** Is pending sync reset */
    isPendingSyncReset: boolean;
    /** Session token */
    token: string;
    /** Last update date */
    updatedAt: string;
};
export type SessionUpdateDto = {
    /** Reset pending sync state */
    isPendingSyncReset?: boolean;
};
export type SharedLinkResponseDto = {
    album?: AlbumResponseDto;
    /** Allow downloads */
    allowDownload: boolean;
    /** Allow uploads */
    allowUpload: boolean;
    assets: AssetResponseDto[];
    /** Creation date */
    createdAt: string;
    /** Link description */
    description: string | null;
    /** Expiration date */
    expiresAt: string | null;
    /** Shared link ID */
    id: string;
    /** Encryption key (base64url) */
    key: string;
    /** Has password */
    password: string | null;
    /** Show metadata */
    showMetadata: boolean;
    /** Custom URL slug */
    slug: string | null;
    "type": SharedLinkType;
    /** Owner user ID */
    userId: string;
};
export type SharedLinkCreateDto = {
    /** Album ID (for album sharing) */
    albumId?: string;
    /** Allow downloads */
    allowDownload?: boolean;
    /** Allow uploads */
    allowUpload?: boolean;
    /** Asset IDs (for individual assets) */
    assetIds?: string[];
    /** Link description */
    description?: string | null;
    /** Expiration date */
    expiresAt?: string | null;
    /** Link password */
    password?: string | null;
    /** Show metadata */
    showMetadata?: boolean;
    /** Custom URL slug */
    slug?: string | null;
    "type": SharedLinkType;
};
export type SharedLinkLoginDto = {
    /** Shared link password */
    password: string;
};
export type SharedLinkEditDto = {
    /** Allow downloads */
    allowDownload?: boolean;
    /** Allow uploads */
    allowUpload?: boolean;
    /** Link description */
    description?: string | null;
    /** Expiration date */
    expiresAt?: string | null;
    /** Link password */
    password?: string | null;
    /** Show metadata */
    showMetadata?: boolean;
    /** Custom URL slug */
    slug?: string | null;
};
export type AssetIdsDto = {
    /** Asset IDs */
    assetIds: string[];
};
export type AssetIdsResponseDto = {
    /** Asset ID */
    assetId: string;
    error?: AssetIdErrorReason;
    /** Whether operation succeeded */
    success: boolean;
};
export type StackResponseDto = {
    assets: AssetResponseDto[];
    /** Stack ID */
    id: string;
    /** Primary asset ID */
    primaryAssetId: string;
};
export type StackCreateDto = {
    /** Asset IDs (first becomes primary, min 2) */
    assetIds: string[];
};
export type StackUpdateDto = {
    /** Primary asset ID */
    primaryAssetId?: string;
};
export type SyncAckDeleteDto = {
    /** Sync entity types to delete acks for */
    types?: SyncEntityType[];
};
export type SyncAckDto = {
    /** Acknowledgment ID */
    ack: string;
    "type": SyncEntityType;
};
export type SyncAckSetDto = {
    /** Acknowledgment IDs (max 1000) */
    acks: string[];
};
export type SyncStreamDto = {
    /** Reset sync state */
    reset?: boolean;
    /** Sync request types */
    types: SyncRequestType[];
};
export type SystemConfigTemplateStorageOptionDto = {
    /** Available day format options for storage template */
    dayOptions: string[];
    /** Available hour format options for storage template */
    hourOptions: string[];
    /** Available minute format options for storage template */
    minuteOptions: string[];
    /** Available month format options for storage template */
    monthOptions: string[];
    /** Available preset template options */
    presetOptions: string[];
    /** Available second format options for storage template */
    secondOptions: string[];
    /** Available week format options for storage template */
    weekOptions: string[];
    /** Available year format options for storage template */
    yearOptions: string[];
};
export type AdminOnboardingUpdateDto = {
    /** Is admin onboarded */
    isOnboarded: boolean;
};
export type ReverseGeocodingStateResponseDto = {
    /** Last import file name */
    lastImportFileName: string | null;
    /** Last update timestamp */
    lastUpdate: string | null;
};
export type TagCreateDto = {
    /** Tag color (hex) */
    color?: string | null;
    /** Tag name */
    name: string;
    /** Parent tag ID */
    parentId?: string | null;
};
export type TagUpsertDto = {
    /** Tag names to upsert */
    tags: string[];
};
export type TagBulkAssetsDto = {
    /** Asset IDs */
    assetIds: string[];
    /** Tag IDs */
    tagIds: string[];
};
export type TagBulkAssetsResponseDto = {
    /** Number of assets tagged */
    count: number;
};
export type TagUpdateDto = {
    /** Tag color (hex) */
    color?: string | null;
    /** Tag name */
    name?: string;
};
export type TimeBucketAssetResponseDto = {
    /** Array of city names extracted from EXIF GPS data */
    city?: (string | null)[];
    /** Array of country names extracted from EXIF GPS data */
    country?: (string | null)[];
    /** Array of UTC timestamps when each asset was originally uploaded to Immich */
    createdAt: string[];
    /** Array of video/gif durations in milliseconds (null for static images) */
    duration: (number | null)[];
    /** Array of file creation timestamps in UTC */
    fileCreatedAt: string[];
    /** Array of asset IDs in the time bucket */
    id: string[];
    /** Array indicating whether each asset is favorited */
    isFavorite: boolean[];
    /** Array indicating whether each asset is an image (false for videos) */
    isImage: boolean[];
    /** Array indicating whether each asset is in the trash */
    isTrashed: boolean[];
    /** Array of latitude coordinates extracted from EXIF GPS data */
    latitude?: (number | null)[];
    /** Array of live photo video asset IDs (null for non-live photos) */
    livePhotoVideoId: (string | null)[];
    /** Array of UTC offset hours at the time each photo was taken. Positive values are east of UTC, negative values are west of UTC. Values may be fractional (e.g., 5.5 for +05:30, -9.75 for -09:45). Applying this offset to 'fileCreatedAt' will give you the time the photo was taken from the photographer's perspective. */
    localOffsetHours: number[];
    /** Array of longitude coordinates extracted from EXIF GPS data */
    longitude?: (number | null)[];
    /** Array of owner IDs for each asset */
    ownerId: string[];
    /** Array of projection types for 360° content (e.g., "EQUIRECTANGULAR", "CUBEFACE", "CYLINDRICAL") */
    projectionType: (string | null)[];
    /** Array of aspect ratios (width/height) for each asset */
    ratio: number[];
    /** Array of stack information as [stackId, assetCount] tuples (null for non-stacked assets) */
    stack?: (string[] | null)[];
    /** Array of BlurHash strings for generating asset previews (base64 encoded) */
    thumbhash: (string | null)[];
    /** Array of visibility statuses for each asset (e.g., ARCHIVE, TIMELINE, HIDDEN, LOCKED) */
    visibility: AssetVisibility[];
};
export type TimeBucketsResponseDto = {
    /** Number of assets in this time bucket */
    count: number;
    /** Time bucket identifier in YYYY-MM-DD format representing the start of the time period */
    timeBucket: string;
};
export type TrashResponseDto = {
    /** Number of items in trash */
    count: number;
};
export type UserUpdateMeDto = {
    avatarColor?: (UserAvatarColor) | null;
    /** User email */
    email?: string;
    /** User name */
    name?: string;
    /** User password (deprecated, use change password endpoint) */
    password?: string;
};
export type OnboardingResponseDto = {
    /** Is user onboarded */
    isOnboarded: boolean;
};
export type OnboardingDto = {
    /** Is user onboarded */
    isOnboarded: boolean;
};
export type CreateProfileImageDto = {
    /** Profile image file */
    file: Blob;
};
export type CreateProfileImageResponseDto = {
    /** Profile image change date */
    profileChangedAt: string;
    /** Profile image file path */
    profileImagePath: string;
    /** User ID */
    userId: string;
};
export type WorkflowStepDto = {
    /** Step configuration */
    config: {
        [key: string]: any;
    } | null;
    /** Step is enabled */
    enabled?: boolean;
    /** Step plugin method */
    method: string;
};
export type WorkflowResponseDto = {
    /** Creation date */
    createdAt: string;
    /** Workflow description */
    description: string | null;
    /** Workflow enabled */
    enabled: boolean;
    /** Workflow ID */
    id: string;
    /** Workflow logs run results */
    logging: boolean;
    /** Workflow name */
    name: string | null;
    /** Workflow steps */
    steps: WorkflowStepDto[];
    /** Workflow trigger type */
    trigger: WorkflowTrigger;
    /** Update date */
    updatedAt: string;
};
export type WorkflowCreateDto = {
    /** Workflow description */
    description?: string | null;
    /** Workflow enabled */
    enabled?: boolean;
    /** Workflow logs run results */
    logging?: boolean;
    /** Workflow name */
    name?: string | null;
    steps?: WorkflowStepDto[];
    /** Workflow trigger type */
    trigger: WorkflowTrigger;
};
export type WorkflowTriggerResponseDto = {
    /** Trigger type */
    trigger: WorkflowTrigger;
    /** Workflow types */
    types: WorkflowType[];
};
export type WorkflowUpdateDto = {
    /** Workflow description */
    description?: string | null;
    /** Workflow enabled */
    enabled?: boolean;
    /** Workflow logs run results */
    logging?: boolean;
    /** Workflow name */
    name?: string | null;
    steps?: WorkflowStepDto[];
    /** Workflow trigger type */
    trigger?: WorkflowTrigger;
};
export type WorkflowLogEntryDto = {
    /** Workflow run date/time */
    at: string;
    /** Workflow log entry ID */
    id: string;
    /** Last step ran, if the workflow ended early */
    lastStep?: {
        /** Index of the step in the workflow */
        index: number;
        /** Method of the step */
        method: string;
    };
    result: WorkflowResult;
    /** Workflow trigger data ID */
    triggerDataId?: string;
};
export type WorkflowShareStepDto = {
    /** Step configuration */
    config: {
        [key: string]: any;
    } | null;
    /** Step is enabled */
    enabled?: boolean;
    /** Step plugin method */
    method: string;
};
export type WorkflowShareResponseDto = {
    /** Workflow description */
    description: string | null;
    /** Workflow name */
    name: string | null;
    /** Workflow steps */
    steps: WorkflowShareStepDto[];
    /** Workflow trigger type */
    trigger: WorkflowTrigger;
};
export type AgentUpdateDto = {
    /** Created or updated message (replace by ID) */
    message?: AgentMessageDto;
    /** Session ID */
    sessionId: string;
    status: AgentSessionStatus;
};
export type LicenseResponseDto = UserLicense;
export type ReleaseEventV1 = {
    /** When the server last checked for a latest version. As an ISO timestamp */
    checkedAt: string;
    /** Whether a new version is available */
    isAvailable: boolean;
    releaseVersion: ServerVersionResponseDto;
    serverVersion: ServerVersionResponseDto;
    /** Release type */
    "type": ReleaseType;
};
export type SyncAckV1 = {};
export type SyncAlbumDeleteV1 = {
    /** Album ID */
    albumId: string;
};
export type SyncAlbumToAssetDeleteV1 = {
    /** Album ID */
    albumId: string;
    /** Asset ID */
    assetId: string;
};
export type SyncAlbumToAssetV1 = {
    /** Album ID */
    albumId: string;
    /** Asset ID */
    assetId: string;
};
export type SyncAlbumUserDeleteV1 = {
    /** Album ID */
    albumId: string;
    /** User ID */
    userId: string;
};
export type SyncAlbumUserV1 = {
    /** Album ID */
    albumId: string;
    role: AlbumUserRole;
    /** User ID */
    userId: string;
};
export type SyncAlbumV1 = {
    /** Created at */
    createdAt: string;
    /** Album description */
    description: string;
    /** Album ID */
    id: string;
    /** Is activity enabled */
    isActivityEnabled: boolean;
    /** Album name */
    name: string;
    order: AssetOrder;
    /** Owner ID */
    ownerId: string;
    /** Thumbnail asset ID */
    thumbnailAssetId: string | null;
    /** Updated at */
    updatedAt: string;
};
export type SyncAlbumV2 = {
    /** Created at */
    createdAt: string;
    /** Album description */
    description: string;
    /** Album ID */
    id: string;
    /** Is activity enabled */
    isActivityEnabled: boolean;
    /** Album name */
    name: string;
    order: AssetOrder;
    /** Thumbnail asset ID */
    thumbnailAssetId: string | null;
    /** Updated at */
    updatedAt: string;
};
export type SyncAssetDeleteV1 = {
    /** Asset ID */
    assetId: string;
};
export type SyncAssetEditDeleteV1 = {
    /** Edit ID */
    editId: string;
};
export type SyncAssetEditV1 = {
    action: AssetEditAction;
    /** Asset ID */
    assetId: string;
    /** Edit ID */
    id: string;
    /** Edit parameters */
    parameters: {
        [key: string]: any;
    };
    /** Edit sequence */
    sequence: number;
};
export type SyncAssetExifV1 = {
    /** Asset ID */
    assetId: string;
    /** City */
    city: string | null;
    /** Country */
    country: string | null;
    /** Date time original */
    dateTimeOriginal: string | null;
    /** Description */
    description: string | null;
    /** Exif image height */
    exifImageHeight: number | null;
    /** Exif image width */
    exifImageWidth: number | null;
    /** Exposure time */
    exposureTime: string | null;
    /** F number */
    fNumber: number | null;
    /** File size in byte */
    fileSizeInByte: number | null;
    /** Focal length */
    focalLength: number | null;
    /** FPS */
    fps: number | null;
    /** ISO */
    iso: number | null;
    /** Latitude */
    latitude: number | null;
    /** Lens model */
    lensModel: string | null;
    /** Longitude */
    longitude: number | null;
    /** Make */
    make: string | null;
    /** Model */
    model: string | null;
    /** Modify date */
    modifyDate: string | null;
    /** Orientation */
    orientation: string | null;
    /** Profile description */
    profileDescription: string | null;
    /** Projection type */
    projectionType: string | null;
    /** Rating */
    rating: number | null;
    /** State */
    state: string | null;
    /** Time zone */
    timeZone: string | null;
};
export type SyncAssetFaceDeleteV1 = {
    /** Asset face ID */
    assetFaceId: string;
};
export type SyncAssetFaceV1 = {
    /** Asset ID */
    assetId: string;
    /** Bounding box X1 */
    boundingBoxX1: number;
    /** Bounding box X2 */
    boundingBoxX2: number;
    /** Bounding box Y1 */
    boundingBoxY1: number;
    /** Bounding box Y2 */
    boundingBoxY2: number;
    /** Asset face ID */
    id: string;
    /** Image height */
    imageHeight: number;
    /** Image width */
    imageWidth: number;
    /** Person ID */
    personId: string | null;
    /** Source type */
    sourceType: string;
};
export type SyncAssetFaceV3 = {
    /** Asset ID */
    assetId: string;
    /** Bounding box X1 */
    boundingBoxX1: number;
    /** Bounding box X2 */
    boundingBoxX2: number;
    /** Bounding box Y1 */
    boundingBoxY1: number;
    /** Bounding box Y2 */
    boundingBoxY2: number;
    /** Face deleted at */
    deletedAt: string | null;
    /** Asset face ID */
    id: string;
    /** Image height */
    imageHeight: number;
    /** Image width */
    imageWidth: number;
    /** Is the face visible in the asset */
    isVisible: boolean;
    /** Person ID */
    personId: string | null;
    /** Source type */
    sourceType: string;
};
export type SyncAssetMetadataDeleteV1 = {
    /** Asset ID */
    assetId: string;
    /** Key */
    key: string;
};
export type SyncAssetMetadataV1 = {
    /** Asset ID */
    assetId: string;
    /** Key */
    key: string;
    /** Value */
    value: {
        [key: string]: any;
    };
};
export type SyncAssetOcrDeleteV1 = {
    /** Original asset ID of the deleted OCR entry */
    assetId: string;
    /** Timestamp when the OCR entry was deleted */
    deletedAt: string;
    /** Audit row ID of the deleted OCR entry */
    id: string;
};
export type SyncAssetOcrV1 = {
    /** Asset ID */
    assetId: string;
    /** Confidence score of the bounding box */
    boxScore: number;
    /** OCR entry ID */
    id: string;
    /** Whether the OCR entry is visible */
    isVisible: boolean;
    /** Recognized text content */
    text: string;
    /** Confidence score of the recognized text */
    textScore: number;
    /** Top-left X coordinate (normalized 0–1) */
    x1: number;
    /** Top-right X coordinate (normalized 0–1) */
    x2: number;
    /** Bottom-right X coordinate (normalized 0–1) */
    x3: number;
    /** Bottom-left X coordinate (normalized 0–1) */
    x4: number;
    /** Top-left Y coordinate (normalized 0–1) */
    y1: number;
    /** Top-right Y coordinate (normalized 0–1) */
    y2: number;
    /** Bottom-right Y coordinate (normalized 0–1) */
    y3: number;
    /** Bottom-left Y coordinate (normalized 0–1) */
    y4: number;
};
export type SyncAssetV1 = {
    /** Checksum */
    checksum: string;
    /** Uploaded to Immich at */
    createdAt: string | null;
    /** Deleted at */
    deletedAt: string | null;
    /** Duration */
    duration: string | null;
    /** File created at */
    fileCreatedAt: string | null;
    /** File modified at */
    fileModifiedAt: string | null;
    /** Asset height */
    height: number | null;
    /** Asset ID */
    id: string;
    /** Is edited */
    isEdited: boolean;
    /** Is favorite */
    isFavorite: boolean;
    /** Library ID */
    libraryId: string | null;
    /** Live photo video ID */
    livePhotoVideoId: string | null;
    /** Local date time */
    localDateTime: string | null;
    /** Original file name */
    originalFileName: string;
    /** Owner ID */
    ownerId: string;
    /** Stack ID */
    stackId: string | null;
    /** Thumbhash */
    thumbhash: string | null;
    "type": AssetTypeEnum;
    visibility: AssetVisibility;
    /** Asset width */
    width: number | null;
};
export type SyncAssetV2 = {
    /** Checksum */
    checksum: string;
    /** Uploaded to Immich at */
    createdAt: string | null;
    /** Deleted at */
    deletedAt: string | null;
    /** Duration */
    duration: number | null;
    /** File created at */
    fileCreatedAt: string | null;
    /** File modified at */
    fileModifiedAt: string | null;
    /** Asset height */
    height: number | null;
    /** Asset ID */
    id: string;
    /** Is edited */
    isEdited: boolean;
    /** Is favorite */
    isFavorite: boolean;
    /** Library ID */
    libraryId: string | null;
    /** Live photo video ID */
    livePhotoVideoId: string | null;
    /** Local date time */
    localDateTime: string | null;
    /** Original file name */
    originalFileName: string;
    /** Owner ID */
    ownerId: string;
    /** Stack ID */
    stackId: string | null;
    /** Thumbhash */
    thumbhash: string | null;
    "type": AssetTypeEnum;
    visibility: AssetVisibility;
    /** Asset width */
    width: number | null;
};
export type SyncAuthUserV1 = {
    avatarColor?: (UserAvatarColor) | null;
    /** User deleted at */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User has profile image */
    hasProfileImage: boolean;
    /** User ID */
    id: string;
    /** User is admin */
    isAdmin: boolean;
    /** User name */
    name: string;
    /** User OAuth ID */
    oauthId: string;
    /** User pin code */
    pinCode: string | null;
    /** User profile changed at */
    profileChangedAt: string;
    /** Quota size in bytes */
    quotaSizeInBytes: number | null;
    /** Quota usage in bytes */
    quotaUsageInBytes: number;
    /** User storage label */
    storageLabel: string | null;
};
export type SyncAuthUserV2 = {
    avatarColor?: (UserAvatarColor) | null;
    /** User deleted at */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User has profile image */
    hasProfileImage: boolean;
    /** User ID */
    id: string;
    /** User is admin */
    isAdmin: boolean;
    /** User name */
    name: string;
    /** User OAuth ID */
    oauthId: string | null;
    /** User pin code */
    pinCode: string | null;
    /** User profile changed at */
    profileChangedAt: string;
    /** Quota size in bytes */
    quotaSizeInBytes: number | null;
    /** Quota usage in bytes */
    quotaUsageInBytes: number;
    /** User storage label */
    storageLabel: string | null;
};
export type SyncCompleteV1 = {};
export type SyncMemoryAssetDeleteV1 = {
    /** Asset ID */
    assetId: string;
    /** Memory ID */
    memoryId: string;
};
export type SyncMemoryAssetV1 = {
    /** Asset ID */
    assetId: string;
    /** Memory ID */
    memoryId: string;
};
export type SyncMemoryDeleteV1 = {
    /** Memory ID */
    memoryId: string;
};
export type SyncMemoryV1 = {
    /** Created at */
    createdAt: string;
    /** Data */
    data: {
        [key: string]: any;
    };
    /** Deleted at */
    deletedAt: string | null;
    /** Hide at */
    hideAt: string | null;
    /** Memory ID */
    id: string;
    /** Is saved */
    isSaved: boolean;
    /** Memory at */
    memoryAt: string;
    /** Owner ID */
    ownerId: string;
    /** Seen at */
    seenAt: string | null;
    /** Show at */
    showAt: string | null;
    "type": MemoryType;
    /** Updated at */
    updatedAt: string;
};
export type SyncPartnerDeleteV1 = {
    /** Shared by ID */
    sharedById: string;
    /** Shared with ID */
    sharedWithId: string;
};
export type SyncPartnerV1 = {
    /** In timeline */
    inTimeline: boolean;
    /** Shared by ID */
    sharedById: string;
    /** Shared with ID */
    sharedWithId: string;
};
export type SyncPersonDeleteV1 = {
    /** Person ID */
    personId: string;
};
export type SyncPersonV1 = {
    /** Birth date */
    birthDate: string | null;
    /** Color */
    color: string | null;
    /** Created at */
    createdAt: string;
    /** Face asset ID */
    faceAssetId: string | null;
    /** Person ID */
    id: string;
    /** Is favorite */
    isFavorite: boolean;
    /** Is hidden */
    isHidden: boolean;
    /** Person name */
    name: string;
    /** Owner ID */
    ownerId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncResetV1 = {};
export type SyncStackDeleteV1 = {
    /** Stack ID */
    stackId: string;
};
export type SyncStackV1 = {
    /** Created at */
    createdAt: string;
    /** Stack ID */
    id: string;
    /** Owner ID */
    ownerId: string;
    /** Primary asset ID */
    primaryAssetId: string;
    /** Updated at */
    updatedAt: string;
};
export type SyncUserDeleteV1 = {
    /** User ID */
    userId: string;
};
export type SyncUserMetadataDeleteV1 = {
    key: UserMetadataKey;
    /** User ID */
    userId: string;
};
export type SyncUserMetadataV1 = {
    key: UserMetadataKey;
    /** User ID */
    userId: string;
    /** User metadata value */
    value: {
        [key: string]: any;
    };
};
export type SyncUserV1 = {
    avatarColor?: (UserAvatarColor) | null;
    /** User deleted at */
    deletedAt: string | null;
    /** User email */
    email: string;
    /** User has profile image */
    hasProfileImage: boolean;
    /** User ID */
    id: string;
    /** User name */
    name: string;
    /** User profile changed at */
    profileChangedAt: string;
};
/**
 * List all activities
 */
export function getActivities({ albumId, assetId, level, $type, userId }: {
    albumId: string;
    assetId?: string;
    level?: ReactionLevel;
    $type?: ReactionType;
    userId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ActivityResponseDto[];
    }>(`/activities${QS.query(QS.explode({
        albumId,
        assetId,
        level,
        "type": $type,
        userId
    }))}`, {
        ...opts
    }));
}
/**
 * Create an activity
 */
export function createActivity({ activityCreateDto }: {
    activityCreateDto: ActivityCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: ActivityResponseDto;
    }>("/activities", oazapfts.json({
        ...opts,
        method: "POST",
        body: activityCreateDto
    })));
}
/**
 * Retrieve activity statistics
 */
export function getActivityStatistics({ albumId, assetId }: {
    albumId: string;
    assetId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ActivityStatisticsResponseDto;
    }>(`/activities/statistics${QS.query(QS.explode({
        albumId,
        assetId
    }))}`, {
        ...opts
    }));
}
/**
 * Delete an activity
 */
export function deleteActivity({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/activities/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Unlink all OAuth accounts
 */
export function unlinkAllOAuthAccountsAdmin(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/auth/unlink-all", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Get the admin configuration
 */
export function getAdminConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminConfigDto;
    }>("/admin/config", {
        ...opts
    }));
}
/**
 * Update the system configuration
 */
export function updateAdminConfig({ adminConfigDto }: {
    adminConfigDto: AdminConfigDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminConfigDto;
    }>("/admin/config", oazapfts.json({
        ...opts,
        method: "PUT",
        body: adminConfigDto
    })));
}
/**
 * Get the system configuration defaults
 */
export function getAdminConfigDefaults(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminConfigDto;
    }>("/admin/config/defaults", {
        ...opts
    }));
}
/**
 * Delete database backup
 */
export function deleteDatabaseBackup({ databaseBackupDeleteDto }: {
    databaseBackupDeleteDto: DatabaseBackupDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/database-backups", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: databaseBackupDeleteDto
    })));
}
/**
 * List database backups
 */
export function listDatabaseBackups(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: DatabaseBackupListResponseDto;
    }>("/admin/database-backups", {
        ...opts
    }));
}
/**
 * Start database backup restore flow
 */
export function startDatabaseRestoreFlow(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/database-backups/start-restore", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Upload database backup
 */
export function uploadDatabaseBackup({ databaseBackupUploadDto }: {
    databaseBackupUploadDto: DatabaseBackupUploadDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/database-backups/upload", oazapfts.multipart({
        ...opts,
        method: "POST",
        body: databaseBackupUploadDto
    })));
}
/**
 * Download database backup
 */
export function downloadDatabaseBackup({ filename }: {
    filename: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/database-backups/${encodeURIComponent(filename)}`, {
        ...opts
    }));
}
/**
 * Get integrity report by type
 */
export function getIntegrityReport({ cursor, limit, $type }: {
    cursor?: string;
    limit?: number;
    $type: IntegrityReport;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: IntegrityReportResponseDto;
    }>(`/admin/integrity/report${QS.query(QS.explode({
        cursor,
        limit,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete integrity report item
 */
export function deleteIntegrityReport({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/admin/integrity/report/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Download flagged file
 */
export function getIntegrityReportFile({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/integrity/report/${encodeURIComponent(id)}/file`, {
        ...opts
    }));
}
/**
 * Export integrity report by type as CSV
 */
export function getIntegrityReportCsv({ $type }: {
    $type: IntegrityReport;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/admin/integrity/report/${encodeURIComponent($type)}/csv`, {
        ...opts
    }));
}
/**
 * Get integrity report summary
 */
export function getIntegrityReportSummary(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: IntegrityReportSummaryResponseDto;
    }>("/admin/integrity/summary", {
        ...opts
    }));
}
/**
 * Set maintenance mode
 */
export function setMaintenanceMode({ setMaintenanceModeDto }: {
    setMaintenanceModeDto: SetMaintenanceModeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/admin/maintenance", oazapfts.json({
        ...opts,
        method: "POST",
        body: setMaintenanceModeDto
    })));
}
/**
 * Detect existing install
 */
export function detectPriorInstall(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MaintenanceDetectInstallResponseDto;
    }>("/admin/maintenance/detect-install", {
        ...opts
    }));
}
/**
 * Log into maintenance mode
 */
export function maintenanceLogin({ maintenanceLoginDto }: {
    maintenanceLoginDto: MaintenanceLoginDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: MaintenanceAuthDto;
    }>("/admin/maintenance/login", oazapfts.json({
        ...opts,
        method: "POST",
        body: maintenanceLoginDto
    })));
}
/**
 * Get maintenance mode status
 */
export function getMaintenanceStatus(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MaintenanceStatusResponseDto;
    }>("/admin/maintenance/status", {
        ...opts
    }));
}
/**
 * Create a notification
 */
export function createNotification({ notificationCreateDto }: {
    notificationCreateDto: NotificationCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: NotificationDto;
    }>("/admin/notifications", oazapfts.json({
        ...opts,
        method: "POST",
        body: notificationCreateDto
    })));
}
/**
 * Render email template
 */
export function getNotificationTemplateAdmin({ name, templateDto }: {
    name: string;
    templateDto: TemplateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TemplateResponseDto;
    }>(`/admin/notifications/templates/${encodeURIComponent(name)}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: templateDto
    })));
}
/**
 * Send test email
 */
export function sendTestEmailAdmin({ adminConfigSmtpDto }: {
    adminConfigSmtpDto: AdminConfigSmtpDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TestEmailResponseDto;
    }>("/admin/notifications/test-email", oazapfts.json({
        ...opts,
        method: "POST",
        body: adminConfigSmtpDto
    })));
}
/**
 * Search users
 */
export function searchUsersAdmin({ id, withDeleted }: {
    id?: string;
    withDeleted?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto[];
    }>(`/admin/users${QS.query(QS.explode({
        id,
        withDeleted
    }))}`, {
        ...opts
    }));
}
/**
 * Create a user
 */
export function createUserAdmin({ userAdminCreateDto }: {
    userAdminCreateDto: UserAdminCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: UserAdminResponseDto;
    }>("/admin/users", oazapfts.json({
        ...opts,
        method: "POST",
        body: userAdminCreateDto
    })));
}
/**
 * Delete a user
 */
export function deleteUserAdmin({ id, userAdminDeleteDto }: {
    id: string;
    userAdminDeleteDto: UserAdminDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: userAdminDeleteDto
    })));
}
/**
 * Retrieve a user
 */
export function getUserAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a user
 */
export function updateUserAdmin({ id, userAdminUpdateDto }: {
    id: string;
    userAdminUpdateDto: UserAdminUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: userAdminUpdateDto
    })));
}
/**
 * Retrieve calendar heatmap activity
 */
export function getUserCalendarHeatmapAdmin({ $from, id, to, $type }: {
    $from?: string;
    id: string;
    to?: string;
    $type?: CalendarHeatmapType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CalendarHeatmapResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/calendar-heatmap${QS.query(QS.explode({
        "from": $from,
        to,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve user preferences
 */
export function getUserPreferencesAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/preferences`, {
        ...opts
    }));
}
/**
 * Update user preferences
 */
export function updateUserPreferencesAdmin({ id, userPreferencesUpdateDto }: {
    id: string;
    userPreferencesUpdateDto: UserPreferencesUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/preferences`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: userPreferencesUpdateDto
    })));
}
/**
 * Restore a deleted user
 */
export function restoreUserAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/restore`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve user sessions
 */
export function getUserSessionsAdmin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SessionResponseDto[];
    }>(`/admin/users/${encodeURIComponent(id)}/sessions`, {
        ...opts
    }));
}
/**
 * Retrieve user statistics
 */
export function getUserStatisticsAdmin({ id, isFavorite, isTrashed, visibility }: {
    id: string;
    isFavorite?: boolean;
    isTrashed?: boolean;
    visibility?: AssetVisibility;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetStatsResponseDto;
    }>(`/admin/users/${encodeURIComponent(id)}/statistics${QS.query(QS.explode({
        isFavorite,
        isTrashed,
        visibility
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve assistant sessions
 */
export function getAgentSessions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionResponseDto[];
    }>("/agent/sessions", {
        ...opts
    }));
}
/**
 * Create an assistant session
 */
export function createAgentSession({ agentSessionCreateDto }: {
    agentSessionCreateDto: AgentSessionCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AgentSessionResponseDto;
    }>("/agent/sessions", oazapfts.json({
        ...opts,
        method: "POST",
        body: agentSessionCreateDto
    })));
}
/**
 * Delete an assistant session
 */
export function deleteAgentSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/sessions/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an assistant session
 */
export function getAgentSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionDetailResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update an assistant session
 */
export function updateAgentSession({ id, agentSessionUpdateDto }: {
    id: string;
    agentSessionUpdateDto: AgentSessionUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AgentSessionResponseDto;
    }>(`/agent/sessions/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: agentSessionUpdateDto
    })));
}
/**
 * Cancel the current assistant turn
 */
export function cancelAgentSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/sessions/${encodeURIComponent(id)}/cancel`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Respond to an assistant permission request
 */
export function respondToAgentPermission({ id, requestId, agentPermissionResponseDto }: {
    id: string;
    requestId: string;
    agentPermissionResponseDto: AgentPermissionResponseDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/sessions/${encodeURIComponent(id)}/permissions/${encodeURIComponent(requestId)}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentPermissionResponseDto
    })));
}
/**
 * Send a message to the assistant
 */
export function promptAgentSession({ id, agentPromptDto }: {
    id: string;
    agentPromptDto: AgentPromptDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/agent/sessions/${encodeURIComponent(id)}/prompt`, oazapfts.json({
        ...opts,
        method: "POST",
        body: agentPromptDto
    })));
}
/**
 * List all albums
 */
export function getAllAlbums({ assetId, id, isOwned, isShared, name }: {
    assetId?: string;
    id?: string;
    isOwned?: boolean;
    isShared?: boolean;
    name?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto[];
    }>(`/albums${QS.query(QS.explode({
        assetId,
        id,
        isOwned,
        isShared,
        name
    }))}`, {
        ...opts
    }));
}
/**
 * Create an album
 */
export function createAlbum({ createAlbumDto }: {
    createAlbumDto: CreateAlbumDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: AlbumResponseDto;
    }>("/albums", oazapfts.json({
        ...opts,
        method: "POST",
        body: createAlbumDto
    })));
}
/**
 * Add assets to albums
 */
export function addAssetsToAlbums({ albumsAddAssetsDto }: {
    albumsAddAssetsDto: AlbumsAddAssetsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumsAddAssetsResponseDto;
    }>("/albums/assets", oazapfts.json({
        ...opts,
        method: "PUT",
        body: albumsAddAssetsDto
    })));
}
/**
 * Retrieve album statistics
 */
export function getAlbumStatistics(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumStatisticsResponseDto;
    }>("/albums/statistics", {
        ...opts
    }));
}
/**
 * Delete an album
 */
export function deleteAlbum({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/albums/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an album
 */
export function getAlbumInfo({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto;
    }>(`/albums/${encodeURIComponent(id)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Update an album
 */
export function updateAlbumInfo({ id, updateAlbumDto }: {
    id: string;
    updateAlbumDto: UpdateAlbumDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto;
    }>(`/albums/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: updateAlbumDto
    })));
}
/**
 * Remove assets from an album
 */
export function removeAssetFromAlbum({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/albums/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Add assets to an album
 */
export function addAssetsToAlbum({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/albums/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bulkIdsDto
    })));
}
/**
 * Retrieve album map markers
 */
export function getAlbumMapMarkers({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapMarkerResponseDto[];
    }>(`/albums/${encodeURIComponent(id)}/map-markers${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Remove user from album
 */
export function removeUserFromAlbum({ id, userId }: {
    id: string;
    userId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/albums/${encodeURIComponent(id)}/user/${encodeURIComponent(userId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update user role
 */
export function updateAlbumUser({ id, userId, updateAlbumUserDto }: {
    id: string;
    userId: string;
    updateAlbumUserDto: UpdateAlbumUserDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/albums/${encodeURIComponent(id)}/user/${encodeURIComponent(userId)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: updateAlbumUserDto
    })));
}
/**
 * Share album with users
 */
export function addUsersToAlbum({ id, addUsersDto }: {
    id: string;
    addUsersDto: AddUsersDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AlbumResponseDto;
    }>(`/albums/${encodeURIComponent(id)}/users`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: addUsersDto
    })));
}
/**
 * List all API keys
 */
export function getApiKeys(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto[];
    }>("/api-keys", {
        ...opts
    }));
}
/**
 * Create an API key
 */
export function createApiKey({ apiKeyCreateDto }: {
    apiKeyCreateDto: ApiKeyCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: ApiKeyCreateResponseDto;
    }>("/api-keys", oazapfts.json({
        ...opts,
        method: "POST",
        body: apiKeyCreateDto
    })));
}
/**
 * Retrieve the current API key
 */
export function getMyApiKey(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto;
    }>("/api-keys/me", {
        ...opts
    }));
}
/**
 * Delete an API key
 */
export function deleteApiKey({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/api-keys/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an API key
 */
export function getApiKey({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto;
    }>(`/api-keys/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update an API key
 */
export function updateApiKey({ id, apiKeyUpdateDto }: {
    id: string;
    apiKeyUpdateDto: ApiKeyUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ApiKeyResponseDto;
    }>(`/api-keys/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: apiKeyUpdateDto
    })));
}
/**
 * Rotate an API key
 */
export function rotateApiKey({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: ApiKeyCreateResponseDto;
    }>(`/api-keys/${encodeURIComponent(id)}/rotate`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Transform a photo into artwork
 */
export function createArtJob({ artJobCreateDto }: {
    artJobCreateDto: ArtJobCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: ArtJobResponseDto;
    }>("/art/jobs", oazapfts.json({
        ...opts,
        method: "POST",
        body: artJobCreateDto
    })));
}
/**
 * Retrieve an art job
 */
export function getArtJob({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ArtJobResponseDto;
    }>(`/art/jobs/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Retrieve artistic styles
 */
export function getArtStyles(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ArtStyleDto[];
    }>("/art/styles", {
        ...opts
    }));
}
/**
 * Search asset files
 */
export function searchAssetFiles({ assetId, isEdited, isProgressive, isTransparent, $type }: {
    assetId: string;
    isEdited?: boolean;
    isProgressive?: boolean;
    isTransparent?: boolean;
    $type?: AssetFileType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetFileResponseDto[];
    }>(`/asset-files${QS.query(QS.explode({
        assetId,
        isEdited,
        isProgressive,
        isTransparent,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete an asset file
 */
export function deleteAssetFile({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/asset-files/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve an asset file
 */
export function getAssetFile({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetFileResponseDto;
    }>(`/asset-files/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Download an asset file
 */
export function downloadAssetFile({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/asset-files/${encodeURIComponent(id)}/download`, {
        ...opts
    }));
}
/**
 * Delete assets
 */
export function deleteAssets({ assetBulkDeleteDto }: {
    assetBulkDeleteDto: AssetBulkDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetBulkDeleteDto
    })));
}
/**
 * Upload asset
 */
export function uploadAsset({ key, slug, xImmichChecksum, assetMediaCreateDto }: {
    key?: string;
    slug?: string;
    xImmichChecksum?: string;
    assetMediaCreateDto: AssetMediaCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMediaResponseDto;
    } | {
        status: 201;
        data: AssetMediaResponseDto;
    }>(`/assets${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.multipart({
        ...opts,
        method: "POST",
        body: assetMediaCreateDto,
        headers: oazapfts.mergeHeaders(opts?.headers, {
            "x-immich-checksum": xImmichChecksum
        })
    })));
}
/**
 * Update assets
 */
export function updateAssets({ assetBulkUpdateDto }: {
    assetBulkUpdateDto: AssetBulkUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets", oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetBulkUpdateDto
    })));
}
/**
 * Check bulk upload
 */
export function checkBulkUpload({ assetBulkUploadCheckDto }: {
    assetBulkUploadCheckDto: AssetBulkUploadCheckDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetBulkUploadCheckResponseDto;
    }>("/assets/bulk-upload-check", oazapfts.json({
        ...opts,
        method: "POST",
        body: assetBulkUploadCheckDto
    })));
}
/**
 * Copy asset
 */
export function copyAsset({ assetCopyDto }: {
    assetCopyDto: AssetCopyDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets/copy", oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetCopyDto
    })));
}
/**
 * Run an asset job
 */
export function runAssetJobs({ assetJobsDto }: {
    assetJobsDto: AssetJobsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets/jobs", oazapfts.json({
        ...opts,
        method: "POST",
        body: assetJobsDto
    })));
}
/**
 * Delete asset metadata
 */
export function deleteBulkAssetMetadata({ assetMetadataBulkDeleteDto }: {
    assetMetadataBulkDeleteDto: AssetMetadataBulkDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/assets/metadata", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetMetadataBulkDeleteDto
    })));
}
/**
 * Upsert asset metadata
 */
export function updateBulkAssetMetadata({ assetMetadataBulkUpsertDto }: {
    assetMetadataBulkUpsertDto: AssetMetadataBulkUpsertDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataBulkResponseDto[];
    }>("/assets/metadata", oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetMetadataBulkUpsertDto
    })));
}
/**
 * Get asset statistics
 */
export function getAssetStatistics({ isFavorite, isTrashed, visibility }: {
    isFavorite?: boolean;
    isTrashed?: boolean;
    visibility?: AssetVisibility;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetStatsResponseDto;
    }>(`/assets/statistics${QS.query(QS.explode({
        isFavorite,
        isTrashed,
        visibility
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve an asset
 */
export function getAssetInfo({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto;
    }>(`/assets/${encodeURIComponent(id)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Update an asset
 */
export function updateAsset({ id, updateAssetDto }: {
    id: string;
    updateAssetDto: UpdateAssetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto;
    }>(`/assets/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: updateAssetDto
    })));
}
/**
 * Remove edits from an existing asset
 */
export function removeAssetEdits({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/assets/${encodeURIComponent(id)}/edits`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve edits for an existing asset
 */
export function getAssetEdits({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetEditsResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/edits`, {
        ...opts
    }));
}
/**
 * Apply edits to an existing asset
 */
export function editAsset({ id, assetEditsCreateDto }: {
    id: string;
    assetEditsCreateDto: AssetEditsCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetEditsResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/edits`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetEditsCreateDto
    })));
}
/**
 * Auto-enhance a photo
 */
export function enhanceAsset({ id, enhanceDto }: {
    id: string;
    enhanceDto: EnhanceDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: EnhanceResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/enhance`, oazapfts.json({
        ...opts,
        method: "POST",
        body: enhanceDto
    })));
}
/**
 * Analyze a photo for auto-enhance
 */
export function analyzeEnhancement({ id, enhancePreviewDto }: {
    id: string;
    enhancePreviewDto: EnhancePreviewDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: EnhanceAnalysisResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/enhance/preview`, oazapfts.json({
        ...opts,
        method: "POST",
        body: enhancePreviewDto
    })));
}
/**
 * Render an auto-enhance preview
 */
export function renderEnhancePreview({ id, strength }: {
    id: string;
    strength?: EnhanceStrength;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/enhance/preview.jpg${QS.query(QS.explode({
        strength
    }))}`, {
        ...opts
    }));
}
/**
 * Get asset metadata
 */
export function getAssetMetadata({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataResponseDto[];
    }>(`/assets/${encodeURIComponent(id)}/metadata`, {
        ...opts
    }));
}
/**
 * Update asset metadata
 */
export function updateAssetMetadata({ id, assetMetadataUpsertDto }: {
    id: string;
    assetMetadataUpsertDto: AssetMetadataUpsertDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataResponseDto[];
    }>(`/assets/${encodeURIComponent(id)}/metadata`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetMetadataUpsertDto
    })));
}
/**
 * Delete asset metadata by key
 */
export function deleteAssetMetadata({ id, key }: {
    id: string;
    key: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/assets/${encodeURIComponent(id)}/metadata/${encodeURIComponent(key)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve asset metadata by key
 */
export function getAssetMetadataByKey({ id, key }: {
    id: string;
    key: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetMetadataResponseDto;
    }>(`/assets/${encodeURIComponent(id)}/metadata/${encodeURIComponent(key)}`, {
        ...opts
    }));
}
/**
 * Retrieve asset OCR data
 */
export function getAssetOcr({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetOcrResponseDto[];
    }>(`/assets/${encodeURIComponent(id)}/ocr`, {
        ...opts
    }));
}
/**
 * Download original asset
 */
export function downloadAsset({ edited, id, key, slug }: {
    edited?: boolean;
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/original${QS.query(QS.explode({
        edited,
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * View asset thumbnail
 */
export function viewAsset({ edited, id, key, size, slug }: {
    edited?: boolean;
    id: string;
    key?: string;
    size?: AssetMediaSize;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/thumbnail${QS.query(QS.explode({
        edited,
        key,
        size,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Play asset video
 */
export function playAssetVideo({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/video/playback${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Get HLS main playlist
 */
export function getMainPlaylist({ id, key, slug }: {
    id: string;
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: string;
    }>(`/assets/${encodeURIComponent(id)}/video/stream/main.m3u8${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * End HLS streaming session
 */
export function endSession({ id, key, sessionId, slug }: {
    id: string;
    key?: string;
    sessionId: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/assets/${encodeURIComponent(id)}/video/stream/${encodeURIComponent(sessionId)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get HLS media playlist
 */
export function getMediaPlaylist({ id, key, sessionId, slug, variantIndex, xImmichHlsPos }: {
    id: string;
    key?: string;
    sessionId: string;
    slug?: string;
    variantIndex: number;
    xImmichHlsPos?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: string;
    }>(`/assets/${encodeURIComponent(id)}/video/stream/${encodeURIComponent(sessionId)}/${encodeURIComponent(variantIndex)}/playlist.m3u8${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts,
        headers: oazapfts.mergeHeaders(opts?.headers, {
            "x-immich-hls-pos": xImmichHlsPos
        })
    }));
}
/**
 * Get HLS segment or init file
 */
export function getSegment({ filename, id, key, sessionId, slug, variantIndex, xImmichHlsMsn }: {
    filename: string;
    id: string;
    key?: string;
    sessionId: string;
    slug?: string;
    variantIndex: number;
    xImmichHlsMsn?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/assets/${encodeURIComponent(id)}/video/stream/${encodeURIComponent(sessionId)}/${encodeURIComponent(variantIndex)}/${encodeURIComponent(filename)}${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts,
        headers: oazapfts.mergeHeaders(opts?.headers, {
            "x-immich-hls-msn": xImmichHlsMsn
        })
    }));
}
/**
 * Register admin
 */
export function signUpAdmin({ signUpDto }: {
    signUpDto: SignUpDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: UserAdminResponseDto;
    }>("/auth/admin-sign-up", oazapfts.json({
        ...opts,
        method: "POST",
        body: signUpDto
    })));
}
/**
 * Change password
 */
export function changePassword({ changePasswordDto }: {
    changePasswordDto: ChangePasswordDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/auth/change-password", oazapfts.json({
        ...opts,
        method: "POST",
        body: changePasswordDto
    })));
}
/**
 * Login
 */
export function login({ loginCredentialDto }: {
    loginCredentialDto: LoginCredentialDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: LoginResponseDto;
    }>("/auth/login", oazapfts.json({
        ...opts,
        method: "POST",
        body: loginCredentialDto
    })));
}
/**
 * Logout
 */
export function logout(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LogoutResponseDto;
    }>("/auth/logout", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Reset pin code
 */
export function resetPinCode({ pinCodeResetDto }: {
    pinCodeResetDto: PinCodeResetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/pin-code", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: pinCodeResetDto
    })));
}
/**
 * Setup pin code
 */
export function setupPinCode({ pinCodeSetupDto }: {
    pinCodeSetupDto: PinCodeSetupDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/pin-code", oazapfts.json({
        ...opts,
        method: "POST",
        body: pinCodeSetupDto
    })));
}
/**
 * Change pin code
 */
export function changePinCode({ pinCodeChangeDto }: {
    pinCodeChangeDto: PinCodeChangeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/pin-code", oazapfts.json({
        ...opts,
        method: "PUT",
        body: pinCodeChangeDto
    })));
}
/**
 * Lock auth session
 */
export function lockAuthSession(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/session/lock", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Unlock auth session
 */
export function unlockAuthSession({ sessionUnlockDto }: {
    sessionUnlockDto: SessionUnlockDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/auth/session/unlock", oazapfts.json({
        ...opts,
        method: "POST",
        body: sessionUnlockDto
    })));
}
/**
 * Retrieve auth status
 */
export function getAuthStatus(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AuthStatusResponseDto;
    }>("/auth/status", {
        ...opts
    }));
}
/**
 * Validate access token
 */
export function validateAccessToken(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ValidateAccessTokenResponseDto;
    }>("/auth/validateToken", {
        ...opts,
        method: "POST"
    }));
}
/**
 * List books
 */
export function getBooks(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookResponseDto[];
    }>("/books", {
        ...opts
    }));
}
/**
 * Create a book
 */
export function createBook({ bookCreateDto }: {
    bookCreateDto: BookCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: BookDetailResponseDto;
    }>("/books", oazapfts.json({
        ...opts,
        method: "POST",
        body: bookCreateDto
    })));
}
/**
 * Create a book from an album
 */
export function createBookFromAlbum({ bookFromAlbumDto }: {
    bookFromAlbumDto: BookFromAlbumDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: BookAutoLayoutResponseDto;
    }>("/books/from-album", oazapfts.json({
        ...opts,
        method: "POST",
        body: bookFromAlbumDto
    })));
}
/**
 * List book layouts
 */
export function getBookLayouts(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookLayoutResponseDto[];
    }>("/books/layouts", {
        ...opts
    }));
}
/**
 * List book style presets
 */
export function getBookStylePresets(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookStylePresetResponseDto[];
    }>("/books/style-presets", {
        ...opts
    }));
}
/**
 * Delete a book
 */
export function deleteBook({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/books/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a book
 */
export function getBook({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookDetailResponseDto;
    }>(`/books/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a book
 */
export function updateBook({ id, bookUpdateDto }: {
    id: string;
    bookUpdateDto: BookUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookDetailResponseDto;
    }>(`/books/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: bookUpdateDto
    })));
}
/**
 * Lay out a book automatically
 */
export function autoLayoutBook({ id, bookAutoLayoutDto }: {
    id: string;
    bookAutoLayoutDto: BookAutoLayoutDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: BookAutoLayoutResponseDto;
    }>(`/books/${encodeURIComponent(id)}/auto-layout`, oazapfts.json({
        ...opts,
        method: "POST",
        body: bookAutoLayoutDto
    })));
}
/**
 * Export a book
 */
export function exportBook({ id, bookExportDto }: {
    id: string;
    bookExportDto?: BookExportDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/books/${encodeURIComponent(id)}/export`, oazapfts.json({
        ...opts,
        method: "POST",
        body: bookExportDto
    })));
}
/**
 * Download a book as HTML
 */
export function downloadBookHtml({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/books/${encodeURIComponent(id)}/html`, {
        ...opts
    }));
}
/**
 * Add a book page
 */
export function addBookPage({ id, bookPageCreateDto }: {
    id: string;
    bookPageCreateDto: BookPageCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: BookPageResponseDto;
    }>(`/books/${encodeURIComponent(id)}/pages`, oazapfts.json({
        ...opts,
        method: "POST",
        body: bookPageCreateDto
    })));
}
/**
 * Remove a book page
 */
export function removeBookPage({ id, pageId }: {
    id: string;
    pageId: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update a book page
 */
export function updateBookPage({ id, pageId, bookPageUpdateDto }: {
    id: string;
    pageId: string;
    bookPageUpdateDto: BookPageUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookPageResponseDto;
    }>(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: bookPageUpdateDto
    })));
}
/**
 * Move a book page
 */
export function moveBookPage({ id, pageId, bookPageMoveDto }: {
    id: string;
    pageId: string;
    bookPageMoveDto: BookPageMoveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookPageResponseDto;
    }>(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/position`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bookPageMoveDto
    })));
}
/**
 * Render a book page
 */
export function renderBookPage({ id, pageId, size }: {
    id: string;
    pageId: string;
    size?: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/render${QS.query(QS.explode({
        size
    }))}`, {
        ...opts
    }));
}
/**
 * Clear a book page slot
 */
export function clearBookSlot({ id, pageId, slot }: {
    id: string;
    pageId: string;
    slot: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookPageResponseDto;
    }>(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/slots/${encodeURIComponent(slot)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update a book page slot
 */
export function updateBookSlot({ id, pageId, slot, bookSlotPatchDto }: {
    id: string;
    pageId: string;
    slot: number;
    bookSlotPatchDto: BookSlotPatchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookPageResponseDto;
    }>(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/slots/${encodeURIComponent(slot)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: bookSlotPatchDto
    })));
}
/**
 * Place a photo in a book page slot
 */
export function setBookSlot({ id, pageId, slot, bookSlotUpdateDto }: {
    id: string;
    pageId: string;
    slot: number;
    bookSlotUpdateDto: BookSlotUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookPageResponseDto;
    }>(`/books/${encodeURIComponent(id)}/pages/${encodeURIComponent(pageId)}/slots/${encodeURIComponent(slot)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bookSlotUpdateDto
    })));
}
/**
 * Download a book PDF
 */
export function downloadBookPdf({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/books/${encodeURIComponent(id)}/pdf`, {
        ...opts
    }));
}
/**
 * Preview a book
 */
export function previewBook({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/books/${encodeURIComponent(id)}/preview`, {
        ...opts
    }));
}
/**
 * Review a book
 */
export function getBookReview({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BookReviewResponseDto;
    }>(`/books/${encodeURIComponent(id)}/review`, {
        ...opts
    }));
}
/**
 * Retrieve cluster group requests
 */
export function getClusterGroupRequests(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ClusterGroupRequestResponseDto[];
    }>("/cluster-groups/requests", {
        ...opts
    }));
}
/**
 * Decline a cluster group request
 */
export function deleteClusterGroupRequest({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/cluster-groups/requests/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Accept a cluster group request
 */
export function acceptClusterGroupRequest({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/cluster-groups/requests/${encodeURIComponent(id)}/accept`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Leave a cluster group
 */
export function leaveClusterGroup({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/cluster-groups/${encodeURIComponent(id)}/leave`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Regenerate people of users in cluster group
 */
export function clusterGroupRegeneratePeople({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/cluster-groups/${encodeURIComponent(id)}/regenerate-people`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve the requests sent by a cluster group
 */
export function getClusterGroupRequestsForGroup({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ClusterGroupRequestResponseDto[];
    }>(`/cluster-groups/${encodeURIComponent(id)}/requests`, {
        ...opts
    }));
}
/**
 * Create a cluster group request
 */
export function createClusterGroupRequest({ id, clusterGroupRequestCreateDto }: {
    id: string;
    clusterGroupRequestCreateDto: ClusterGroupRequestCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ClusterGroupRequestResponseDto;
    }>(`/cluster-groups/${encodeURIComponent(id)}/requests`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: clusterGroupRequestCreateDto
    })));
}
/**
 * Retrieve the users of a cluster group
 */
export function getClusterGroupUsers({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserResponseDto[];
    }>(`/cluster-groups/${encodeURIComponent(id)}/users`, {
        ...opts
    }));
}
/**
 * List collection packs
 */
export function getCollectionPacks(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CollectionPackResponseDto[];
    }>("/collections", {
        ...opts
    }));
}
/**
 * Summarize the collections
 */
export function getCollectionSummary(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CollectionSummaryResponseDto;
    }>("/collections/summary", {
        ...opts
    }));
}
/**
 * Name the entries of a visit
 */
export function saveCollectionEntries({ pack, collectionEntriesDto }: {
    pack: string;
    collectionEntriesDto: CollectionEntriesDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CollectionEntriesResponseDto;
    }>(`/collections/${encodeURIComponent(pack)}/entries`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: collectionEntriesDto
    })));
}
/**
 * Match the subjects of a visit
 */
export function matchCollectionVisit({ pack, collectionMatchDto }: {
    pack: string;
    collectionMatchDto: CollectionMatchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CollectionMatchResponseDto;
    }>(`/collections/${encodeURIComponent(pack)}/match`, oazapfts.json({
        ...opts,
        method: "POST",
        body: collectionMatchDto
    })));
}
/**
 * Find the visits of a collection
 */
export function findCollectionVisits({ pack, collectionVisitsDto }: {
    pack: string;
    collectionVisitsDto: CollectionVisitsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CollectionVisitsResponseDto;
    }>(`/collections/${encodeURIComponent(pack)}/visits`, oazapfts.json({
        ...opts,
        method: "POST",
        body: collectionVisitsDto
    })));
}
/**
 * Get the configuration with user visibility
 */
export function getUserConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserConfigDto;
    }>("/config", {
        ...opts
    }));
}
/**
 * Get the default configuration with user visibility
 */
export function getUserConfigDefaults(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserConfigDto;
    }>("/config/defaults", {
        ...opts
    }));
}
/**
 * Download asset archive
 */
export function downloadArchive({ key, slug, downloadArchiveDto }: {
    key?: string;
    slug?: string;
    downloadArchiveDto: DownloadArchiveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/download/archive${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: downloadArchiveDto
    })));
}
/**
 * Retrieve download information
 */
export function getDownloadInfo({ key, slug, downloadInfoDto }: {
    key?: string;
    slug?: string;
    downloadInfoDto: DownloadInfoDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: DownloadResponseDto;
    }>(`/download/info${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: downloadInfoDto
    })));
}
/**
 * Delete duplicates
 */
export function deleteDuplicates({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/duplicates", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Retrieve duplicates
 */
export function getAssetDuplicates(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: DuplicateResponseDto[];
    }>("/duplicates", {
        ...opts
    }));
}
/**
 * Resolve duplicate groups
 */
export function resolveDuplicates({ duplicateResolveDto }: {
    duplicateResolveDto: DuplicateResolveDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>("/duplicates/resolve", oazapfts.json({
        ...opts,
        method: "POST",
        body: duplicateResolveDto
    })));
}
/**
 * Dismiss a duplicate group
 */
export function deleteDuplicate({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/duplicates/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve faces for asset
 */
export function getFaces({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetFaceResponseDto[];
    }>(`/faces${QS.query(QS.explode({
        id
    }))}`, {
        ...opts
    }));
}
/**
 * Create a face
 */
export function createFace({ assetFaceCreateDto }: {
    assetFaceCreateDto: AssetFaceCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/faces", oazapfts.json({
        ...opts,
        method: "POST",
        body: assetFaceCreateDto
    })));
}
/**
 * Delete a face
 */
export function deleteFace({ id, assetFaceDeleteDto }: {
    id: string;
    assetFaceDeleteDto: AssetFaceDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/faces/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetFaceDeleteDto
    })));
}
/**
 * Re-assign a face to another person
 */
export function reassignFacesById({ id, faceDto }: {
    id: string;
    faceDto: FaceDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/faces/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: faceDto
    })));
}
/**
 * Name dishes
 */
export function setDishNames({ foodDishesDto }: {
    foodDishesDto: FoodDishesDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FoodDishesResponseDto;
    }>("/food/dishes", oazapfts.json({
        ...opts,
        method: "PUT",
        body: foodDishesDto
    })));
}
/**
 * Find meals
 */
export function findMeals({ foodMealsDto }: {
    foodMealsDto: FoodMealsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FoodMealsResponseDto;
    }>("/food/meals", oazapfts.json({
        ...opts,
        method: "POST",
        body: foodMealsDto
    })));
}
/**
 * Match the dishes of a meal
 */
export function matchMeal({ foodMatchDto }: {
    foodMatchDto: FoodMatchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: FoodMatchResponseDto;
    }>("/food/meals/match", oazapfts.json({
        ...opts,
        method: "POST",
        body: foodMatchDto
    })));
}
/**
 * Retrieve queue counts and status
 */
export function getQueuesLegacy(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueuesResponseLegacyDto;
    }>("/jobs", {
        ...opts
    }));
}
/**
 * Create a manual job
 */
export function createJob({ jobCreateDto }: {
    jobCreateDto: JobCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/jobs", oazapfts.json({
        ...opts,
        method: "POST",
        body: jobCreateDto
    })));
}
/**
 * Run jobs
 */
export function runQueueCommandLegacy({ name, queueCommandDto }: {
    name: QueueName;
    queueCommandDto: QueueCommandDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseLegacyDto;
    }>(`/jobs/${encodeURIComponent(name)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: queueCommandDto
    })));
}
/**
 * Retrieve libraries
 */
export function getAllLibraries(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryResponseDto[];
    }>("/libraries", {
        ...opts
    }));
}
/**
 * Create a library
 */
export function createLibrary({ createLibraryDto }: {
    createLibraryDto: CreateLibraryDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: LibraryResponseDto;
    }>("/libraries", oazapfts.json({
        ...opts,
        method: "POST",
        body: createLibraryDto
    })));
}
/**
 * Delete a library
 */
export function deleteLibrary({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/libraries/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a library
 */
export function getLibrary({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a library
 */
export function updateLibrary({ id, updateLibraryDto }: {
    id: string;
    updateLibraryDto: UpdateLibraryDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: updateLibraryDto
    })));
}
/**
 * Scan a library
 */
export function scanLibrary({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/libraries/${encodeURIComponent(id)}/scan`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve library statistics
 */
export function getLibraryStatistics({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: LibraryStatsResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}/statistics`, {
        ...opts
    }));
}
/**
 * Validate library settings
 */
export function validate({ id, validateLibraryDto }: {
    id: string;
    validateLibraryDto: ValidateLibraryDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ValidateLibraryResponseDto;
    }>(`/libraries/${encodeURIComponent(id)}/validate`, oazapfts.json({
        ...opts,
        method: "POST",
        body: validateLibraryDto
    })));
}
/**
 * Retrieve map markers
 */
export function getMapMarkers({ fileCreatedAfter, fileCreatedBefore, isArchived, isFavorite, withPartners, withSharedAlbums }: {
    fileCreatedAfter?: string;
    fileCreatedBefore?: string;
    isArchived?: boolean;
    isFavorite?: boolean;
    withPartners?: boolean;
    withSharedAlbums?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapMarkerResponseDto[];
    }>(`/map/markers${QS.query(QS.explode({
        fileCreatedAfter,
        fileCreatedBefore,
        isArchived,
        isFavorite,
        withPartners,
        withSharedAlbums
    }))}`, {
        ...opts
    }));
}
/**
 * Reverse geocode coordinates
 */
export function reverseGeocode({ lat, lon }: {
    lat: number;
    lon: number;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MapReverseGeocodeResponseDto[];
    }>(`/map/reverse-geocode${QS.query(QS.explode({
        lat,
        lon
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve memories
 */
export function searchMemories({ $for, id, isSaved, isTrashed, isUpcoming, order, page, size, $type }: {
    $for?: string;
    id?: string;
    isSaved?: boolean;
    isTrashed?: boolean;
    isUpcoming?: boolean;
    order?: MemorySearchOrder;
    page?: number;
    size?: number;
    $type?: MemoryType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryResponseDto[];
    }>(`/memories${QS.query(QS.explode({
        "for": $for,
        id,
        isSaved,
        isTrashed,
        isUpcoming,
        order,
        page,
        size,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Create a memory
 */
export function createMemory({ memoryCreateDto }: {
    memoryCreateDto: MemoryCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: MemoryResponseDto;
    }>("/memories", oazapfts.json({
        ...opts,
        method: "POST",
        body: memoryCreateDto
    })));
}
/**
 * Retrieve memories statistics
 */
export function memoriesStatistics({ $for, id, isSaved, isTrashed, isUpcoming, order, page, size, $type }: {
    $for?: string;
    id?: string;
    isSaved?: boolean;
    isTrashed?: boolean;
    isUpcoming?: boolean;
    order?: MemorySearchOrder;
    page?: number;
    size?: number;
    $type?: MemoryType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryStatisticsResponseDto;
    }>(`/memories/statistics${QS.query(QS.explode({
        "for": $for,
        id,
        isSaved,
        isTrashed,
        isUpcoming,
        order,
        page,
        size,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete a memory
 */
export function deleteMemory({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/memories/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a memory
 */
export function getMemory({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryResponseDto;
    }>(`/memories/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a memory
 */
export function updateMemory({ id, memoryUpdateDto }: {
    id: string;
    memoryUpdateDto: MemoryUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: MemoryResponseDto;
    }>(`/memories/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: memoryUpdateDto
    })));
}
/**
 * Remove assets from a memory
 */
export function removeMemoryAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/memories/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Add assets to a memory
 */
export function addMemoryAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/memories/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bulkIdsDto
    })));
}
/**
 * Delete notifications
 */
export function deleteNotifications({ notificationDeleteAllDto }: {
    notificationDeleteAllDto: NotificationDeleteAllDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/notifications", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: notificationDeleteAllDto
    })));
}
/**
 * Retrieve notifications
 */
export function getNotifications({ id, level, $type, unread }: {
    id?: string;
    level?: NotificationLevel;
    $type?: NotificationType;
    unread?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: NotificationDto[];
    }>(`/notifications${QS.query(QS.explode({
        id,
        level,
        "type": $type,
        unread
    }))}`, {
        ...opts
    }));
}
/**
 * Update notifications
 */
export function updateNotifications({ notificationUpdateAllDto }: {
    notificationUpdateAllDto: NotificationUpdateAllDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/notifications", oazapfts.json({
        ...opts,
        method: "PUT",
        body: notificationUpdateAllDto
    })));
}
/**
 * Delete a notification
 */
export function deleteNotification({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/notifications/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a notification
 */
export function getNotification({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: NotificationDto;
    }>(`/notifications/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a notification
 */
export function updateNotification({ id, notificationUpdateDto }: {
    id: string;
    notificationUpdateDto: NotificationUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: NotificationDto;
    }>(`/notifications/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: notificationUpdateDto
    })));
}
/**
 * Start OAuth
 */
export function startOAuth({ oAuthConfigDto }: {
    oAuthConfigDto: OAuthConfigDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: OAuthAuthorizeResponseDto;
    }>("/oauth/authorize", oazapfts.json({
        ...opts,
        method: "POST",
        body: oAuthConfigDto
    })));
}
/**
 * Backchannel OAuth logout
 */
export function logoutOAuth({ oAuthBackchannelLogoutDto }: {
    oAuthBackchannelLogoutDto: OAuthBackchannelLogoutDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/oauth/backchannel-logout", oazapfts.form({
        ...opts,
        method: "POST",
        body: oAuthBackchannelLogoutDto
    })));
}
/**
 * Finish OAuth
 */
export function finishOAuth({ oAuthCallbackDto }: {
    oAuthCallbackDto: OAuthCallbackDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: LoginResponseDto;
    }>("/oauth/callback", oazapfts.json({
        ...opts,
        method: "POST",
        body: oAuthCallbackDto
    })));
}
/**
 * Link OAuth account
 */
export function linkOAuthAccount({ oAuthCallbackDto }: {
    oAuthCallbackDto: OAuthCallbackDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/oauth/link", oazapfts.json({
        ...opts,
        method: "POST",
        body: oAuthCallbackDto
    })));
}
/**
 * Redirect OAuth to mobile
 */
export function redirectOAuthToMobile(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/oauth/mobile-redirect", {
        ...opts
    }));
}
/**
 * Unlink OAuth account
 */
export function unlinkOAuthAccount(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/oauth/unlink", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve partners
 */
export function getPartners({ direction }: {
    direction: PartnerDirection;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PartnerResponseDto[];
    }>(`/partners${QS.query(QS.explode({
        direction
    }))}`, {
        ...opts
    }));
}
/**
 * Create a partner
 */
export function createPartner({ partnerCreateDto }: {
    partnerCreateDto: PartnerCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: PartnerResponseDto;
    }>("/partners", oazapfts.json({
        ...opts,
        method: "POST",
        body: partnerCreateDto
    })));
}
/**
 * Remove a partner
 */
export function removePartner({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/partners/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Create a partner
 */
export function createPartnerDeprecated({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: PartnerResponseDto;
    }>(`/partners/${encodeURIComponent(id)}`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Update a partner
 */
export function updatePartner({ id, partnerUpdateDto }: {
    id: string;
    partnerUpdateDto: PartnerUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PartnerResponseDto;
    }>(`/partners/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: partnerUpdateDto
    })));
}
/**
 * Delete people
 */
export function deletePeople({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/people", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Get all people
 */
export function getAllPeople({ closestAssetId, closestPersonId, page, size, withHidden }: {
    closestAssetId?: string;
    closestPersonId?: string;
    page?: number;
    size?: number;
    withHidden?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PeopleResponseDto;
    }>(`/people${QS.query(QS.explode({
        closestAssetId,
        closestPersonId,
        page,
        size,
        withHidden
    }))}`, {
        ...opts
    }));
}
/**
 * Create a person
 */
export function createPerson({ personCreateDto }: {
    personCreateDto: PersonCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: PersonResponseDto;
    }>("/people", oazapfts.json({
        ...opts,
        method: "POST",
        body: personCreateDto
    })));
}
/**
 * Update people
 */
export function updatePeople({ peopleUpdateDto }: {
    peopleUpdateDto: PeopleUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>("/people", oazapfts.json({
        ...opts,
        method: "PUT",
        body: peopleUpdateDto
    })));
}
/**
 * Merge people
 */
export function mergePeople({ mergePersonDto }: {
    mergePersonDto: MergePersonDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>("/people/merge", oazapfts.json({
        ...opts,
        method: "POST",
        body: mergePersonDto
    })));
}
/**
 * Delete person
 */
export function deletePerson({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/people/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get a person
 */
export function getPerson({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/people/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update person
 */
export function updatePerson({ id, personUpdateDto }: {
    id: string;
    personUpdateDto: PersonUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto;
    }>(`/people/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: personUpdateDto
    })));
}
/**
 * Merge people
 */
export function mergePersonLegacy({ id, mergePersonDto }: {
    id: string;
    mergePersonDto: MergePersonDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/people/${encodeURIComponent(id)}/merge`, oazapfts.json({
        ...opts,
        method: "POST",
        body: mergePersonDto
    })));
}
/**
 * Reassign faces
 */
export function reassignFaces({ id, assetFaceUpdateDto }: {
    id: string;
    assetFaceUpdateDto: AssetFaceUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto[];
    }>(`/people/${encodeURIComponent(id)}/reassign`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetFaceUpdateDto
    })));
}
/**
 * Get person statistics
 */
export function getPersonStatistics({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonStatisticsResponseDto;
    }>(`/people/${encodeURIComponent(id)}/statistics`, {
        ...opts
    }));
}
/**
 * Get person thumbnail
 */
export function getPersonThumbnail({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/people/${encodeURIComponent(id)}/thumbnail`, {
        ...opts
    }));
}
/**
 * List all plugins
 */
export function searchPlugins({ description, enabled, id, name, title, version }: {
    description?: string;
    enabled?: boolean;
    id?: string;
    name?: string;
    title?: string;
    version?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginResponseDto[];
    }>(`/plugins${QS.query(QS.explode({
        description,
        enabled,
        id,
        name,
        title,
        version
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve plugin methods
 */
export function searchPluginMethods({ description, enabled, id, name, pluginName, pluginVersion, title, trigger, $type }: {
    description?: string;
    enabled?: boolean;
    id?: string;
    name?: string;
    pluginName?: string;
    pluginVersion?: string;
    title?: string;
    trigger?: WorkflowTrigger;
    $type?: WorkflowType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginMethodResponseDto[];
    }>(`/plugins/methods${QS.query(QS.explode({
        description,
        enabled,
        id,
        name,
        pluginName,
        pluginVersion,
        title,
        trigger,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve workflow templates
 */
export function searchPluginTemplates(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginTemplateResponseDto[];
    }>("/plugins/templates", {
        ...opts
    }));
}
/**
 * Retrieve a plugin
 */
export function getPlugin({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PluginResponseDto;
    }>(`/plugins/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Get the public configuration
 */
export function getPublicConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PublicConfigDto;
    }>("/public/config", {
        ...opts
    }));
}
/**
 * Get the public configuration defaults
 */
export function getPublicConfigDefaults(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PublicConfigDto;
    }>("/public/config/defaults", {
        ...opts
    }));
}
/**
 * List all queues
 */
export function getQueues(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseDto[];
    }>("/queues", {
        ...opts
    }));
}
/**
 * Retrieve a queue
 */
export function getQueue({ name }: {
    name: QueueName;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseDto;
    }>(`/queues/${encodeURIComponent(name)}`, {
        ...opts
    }));
}
/**
 * Update a queue
 */
export function updateQueue({ name, queueUpdateDto }: {
    name: QueueName;
    queueUpdateDto: QueueUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueResponseDto;
    }>(`/queues/${encodeURIComponent(name)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: queueUpdateDto
    })));
}
/**
 * Empty a queue
 */
export function emptyQueue({ name, queueDeleteDto }: {
    name: QueueName;
    queueDeleteDto: QueueDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/queues/${encodeURIComponent(name)}/jobs`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: queueDeleteDto
    })));
}
/**
 * Retrieve queue jobs
 */
export function getQueueJobs({ name, status }: {
    name: QueueName;
    status?: QueueJobStatus[];
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: QueueJobResponseDto[];
    }>(`/queues/${encodeURIComponent(name)}/jobs${QS.query(QS.explode({
        status
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve assets by city
 */
export function getAssetsByCity(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>("/search/cities", {
        ...opts
    }));
}
/**
 * Retrieve explore data
 */
export function getExploreData(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchExploreResponseDto[];
    }>("/search/explore", {
        ...opts
    }));
}
/**
 * Search large assets
 */
export function searchLargeAssets({ albumIds, city, country, createdAfter, createdBefore, isEncoded, isFavorite, isMotion, isNotInAlbum, isOffline, lensModel, libraryId, make, minFileSize, model, ocr, personIds, rating, size, state, tagIds, takenAfter, takenBefore, trashedAfter, trashedBefore, $type, updatedAfter, updatedBefore, visibility, withDeleted, withExif }: {
    albumIds?: string[];
    city?: string | null;
    country?: string | null;
    createdAfter?: string;
    createdBefore?: string;
    isEncoded?: boolean;
    isFavorite?: boolean;
    isMotion?: boolean;
    isNotInAlbum?: boolean;
    isOffline?: boolean;
    lensModel?: string | null;
    libraryId?: string | null;
    make?: string | null;
    minFileSize?: number;
    model?: string | null;
    ocr?: string;
    personIds?: string[];
    rating?: number | null;
    size?: number;
    state?: string | null;
    tagIds?: string[] | null;
    takenAfter?: string;
    takenBefore?: string;
    trashedAfter?: string;
    trashedBefore?: string;
    $type?: AssetTypeEnum;
    updatedAfter?: string;
    updatedBefore?: string;
    visibility?: AssetVisibility;
    withDeleted?: boolean;
    withExif?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>(`/search/large-assets${QS.query(QS.explode({
        albumIds,
        city,
        country,
        createdAfter,
        createdBefore,
        isEncoded,
        isFavorite,
        isMotion,
        isNotInAlbum,
        isOffline,
        lensModel,
        libraryId,
        make,
        minFileSize,
        model,
        ocr,
        personIds,
        rating,
        size,
        state,
        tagIds,
        takenAfter,
        takenBefore,
        trashedAfter,
        trashedBefore,
        "type": $type,
        updatedAfter,
        updatedBefore,
        visibility,
        withDeleted,
        withExif
    }))}`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Search assets by metadata
 */
export function searchAssets({ key, slug, metadataSearchDto }: {
    key?: string;
    slug?: string;
    metadataSearchDto: MetadataSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchResponseDto;
    }>(`/search/metadata${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: metadataSearchDto
    })));
}
/**
 * Search people
 */
export function searchPerson({ name, withHidden }: {
    name: string;
    withHidden?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PersonResponseDto[];
    }>(`/search/person${QS.query(QS.explode({
        name,
        withHidden
    }))}`, {
        ...opts
    }));
}
/**
 * Search places
 */
export function searchPlaces({ name }: {
    name: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: PlacesResponseDto[];
    }>(`/search/places${QS.query(QS.explode({
        name
    }))}`, {
        ...opts
    }));
}
/**
 * Search random assets
 */
export function searchRandom({ randomSearchDto }: {
    randomSearchDto: RandomSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>("/search/random", oazapfts.json({
        ...opts,
        method: "POST",
        body: randomSearchDto
    })));
}
/**
 * Smart asset search
 */
export function searchSmart({ smartSearchDto }: {
    smartSearchDto: SmartSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchResponseDto;
    }>("/search/smart", oazapfts.json({
        ...opts,
        method: "POST",
        body: smartSearchDto
    })));
}
/**
 * Search asset statistics
 */
export function searchAssetStatistics({ statisticsSearchDto }: {
    statisticsSearchDto: StatisticsSearchDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SearchStatisticsResponseDto;
    }>("/search/statistics", oazapfts.json({
        ...opts,
        method: "POST",
        body: statisticsSearchDto
    })));
}
/**
 * Retrieve search suggestions
 */
export function getSearchSuggestions({ country, includeNull, lensModel, make, model, state, $type }: {
    country?: string;
    includeNull?: boolean;
    lensModel?: string;
    make?: string;
    model?: string;
    state?: string;
    $type: SearchSuggestionType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: string[];
    }>(`/search/suggestions${QS.query(QS.explode({
        country,
        includeNull,
        lensModel,
        make,
        model,
        state,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Get server information
 */
export function getAboutInfo(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerAboutResponseDto;
    }>("/server/about", {
        ...opts
    }));
}
/**
 * Get APK links
 */
export function getApkLinks(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerApkLinksDto;
    }>("/server/apk-links", {
        ...opts
    }));
}
/**
 * Get config
 */
export function getServerConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerConfigDto;
    }>("/server/config", {
        ...opts
    }));
}
/**
 * Get features
 */
export function getServerFeatures(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerFeaturesDto;
    }>("/server/features", {
        ...opts
    }));
}
/**
 * Delete server product key
 */
export function deleteServerLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/server/license", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Get product key
 */
export function getServerLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    } | {
        status: 404;
    }>("/server/license", {
        ...opts
    }));
}
/**
 * Set server product key
 */
export function setServerLicense({ licenseKeyDto }: {
    licenseKeyDto: LicenseKeyDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    }>("/server/license", oazapfts.json({
        ...opts,
        method: "PUT",
        body: licenseKeyDto
    })));
}
/**
 * Get supported media types
 */
export function getSupportedMediaTypes(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerMediaTypesResponseDto;
    }>("/server/media-types", {
        ...opts
    }));
}
/**
 * Ping
 */
export function pingServer(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerPingResponse;
    }>("/server/ping", {
        ...opts
    }));
}
/**
 * Get statistics
 */
export function getServerStatistics(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerStatsResponseDto;
    }>("/server/statistics", {
        ...opts
    }));
}
/**
 * Get storage
 */
export function getStorage(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerStorageResponseDto;
    }>("/server/storage", {
        ...opts
    }));
}
/**
 * Get server version
 */
export function getServerVersion(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerVersionResponseDto;
    }>("/server/version", {
        ...opts
    }));
}
/**
 * Get version check status
 */
export function getVersionCheck(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: VersionCheckStateResponseDto;
    }>("/server/version-check", {
        ...opts
    }));
}
/**
 * Get version history
 */
export function getVersionHistory(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ServerVersionHistoryResponseDto[];
    }>("/server/version-history", {
        ...opts
    }));
}
/**
 * Delete all sessions
 */
export function deleteAllSessions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sessions", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve sessions
 */
export function getSessions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SessionResponseDto[];
    }>("/sessions", {
        ...opts
    }));
}
/**
 * Create a session
 */
export function createSession({ sessionCreateDto }: {
    sessionCreateDto: SessionCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SessionCreateResponseDto;
    }>("/sessions", oazapfts.json({
        ...opts,
        method: "POST",
        body: sessionCreateDto
    })));
}
/**
 * Delete a session
 */
export function deleteSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/sessions/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Update a session
 */
export function updateSession({ id, sessionUpdateDto }: {
    id: string;
    sessionUpdateDto: SessionUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SessionResponseDto;
    }>(`/sessions/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: sessionUpdateDto
    })));
}
/**
 * Lock a session
 */
export function lockSession({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/sessions/${encodeURIComponent(id)}/lock`, {
        ...opts,
        method: "POST"
    }));
}
/**
 * Retrieve all shared links
 */
export function getAllSharedLinks({ albumId, id }: {
    albumId?: string;
    id?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto[];
    }>(`/shared-links${QS.query(QS.explode({
        albumId,
        id
    }))}`, {
        ...opts
    }));
}
/**
 * Create a shared link
 */
export function createSharedLink({ sharedLinkCreateDto }: {
    sharedLinkCreateDto: SharedLinkCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedLinkResponseDto;
    }>("/shared-links", oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedLinkCreateDto
    })));
}
/**
 * Shared link login
 */
export function sharedLinkLogin({ key, slug, sharedLinkLoginDto }: {
    key?: string;
    slug?: string;
    sharedLinkLoginDto: SharedLinkLoginDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: SharedLinkResponseDto;
    }>(`/shared-links/login${QS.query(QS.explode({
        key,
        slug
    }))}`, oazapfts.json({
        ...opts,
        method: "POST",
        body: sharedLinkLoginDto
    })));
}
/**
 * Retrieve current shared link
 */
export function getMySharedLink({ key, slug }: {
    key?: string;
    slug?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto;
    }>(`/shared-links/me${QS.query(QS.explode({
        key,
        slug
    }))}`, {
        ...opts
    }));
}
/**
 * Delete a shared link
 */
export function removeSharedLink({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/shared-links/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a shared link
 */
export function getSharedLinkById({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto;
    }>(`/shared-links/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a shared link
 */
export function updateSharedLink({ id, sharedLinkEditDto }: {
    id: string;
    sharedLinkEditDto: SharedLinkEditDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SharedLinkResponseDto;
    }>(`/shared-links/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PATCH",
        body: sharedLinkEditDto
    })));
}
/**
 * Remove assets from a shared link
 */
export function removeSharedLinkAssets({ id, assetIdsDto }: {
    id: string;
    assetIdsDto: AssetIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetIdsResponseDto[];
    }>(`/shared-links/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: assetIdsDto
    })));
}
/**
 * Add assets to a shared link
 */
export function addSharedLinkAssets({ id, assetIdsDto }: {
    id: string;
    assetIdsDto: AssetIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetIdsResponseDto[];
    }>(`/shared-links/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: assetIdsDto
    })));
}
/**
 * Delete stacks
 */
export function deleteStacks({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/stacks", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Retrieve stacks
 */
export function searchStacks({ primaryAssetId }: {
    primaryAssetId?: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: StackResponseDto[];
    }>(`/stacks${QS.query(QS.explode({
        primaryAssetId
    }))}`, {
        ...opts
    }));
}
/**
 * Create a stack
 */
export function createStack({ stackCreateDto }: {
    stackCreateDto: StackCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: StackResponseDto;
    }>("/stacks", oazapfts.json({
        ...opts,
        method: "POST",
        body: stackCreateDto
    })));
}
/**
 * Delete a stack
 */
export function deleteStack({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/stacks/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a stack
 */
export function getStack({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: StackResponseDto;
    }>(`/stacks/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a stack
 */
export function updateStack({ id, stackUpdateDto }: {
    id: string;
    stackUpdateDto: StackUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: StackResponseDto;
    }>(`/stacks/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: stackUpdateDto
    })));
}
/**
 * Remove an asset from a stack
 */
export function removeAssetFromStack({ assetId, id }: {
    assetId: string;
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/stacks/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Delete acknowledgements
 */
export function deleteSyncAck({ syncAckDeleteDto }: {
    syncAckDeleteDto: SyncAckDeleteDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sync/ack", oazapfts.json({
        ...opts,
        method: "DELETE",
        body: syncAckDeleteDto
    })));
}
/**
 * Retrieve acknowledgements
 */
export function getSyncAck(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SyncAckDto[];
    }>("/sync/ack", {
        ...opts
    }));
}
/**
 * Acknowledge changes
 */
export function sendSyncAck({ syncAckSetDto }: {
    syncAckSetDto: SyncAckSetDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sync/ack", oazapfts.json({
        ...opts,
        method: "POST",
        body: syncAckSetDto
    })));
}
/**
 * Stream sync changes
 */
export function getSyncStream({ syncStreamDto }: {
    syncStreamDto: SyncStreamDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/sync/stream", oazapfts.json({
        ...opts,
        method: "POST",
        body: syncStreamDto
    })));
}
/**
 * Get system configuration
 */
export function getConfig(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminConfigDto;
    }>("/system-config", {
        ...opts
    }));
}
/**
 * Update system configuration
 */
export function updateConfig({ adminConfigDto }: {
    adminConfigDto: AdminConfigDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminConfigDto;
    }>("/system-config", oazapfts.json({
        ...opts,
        method: "PUT",
        body: adminConfigDto
    })));
}
/**
 * Get system configuration defaults
 */
export function getConfigDefaults(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminConfigDto;
    }>("/system-config/defaults", {
        ...opts
    }));
}
/**
 * Get storage template options
 */
export function getStorageTemplateOptions(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: SystemConfigTemplateStorageOptionDto;
    }>("/system-config/storage-template-options", {
        ...opts
    }));
}
/**
 * Retrieve admin onboarding
 */
export function getAdminOnboarding(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AdminOnboardingUpdateDto;
    }>("/system-metadata/admin-onboarding", {
        ...opts
    }));
}
/**
 * Update admin onboarding
 */
export function updateAdminOnboarding({ adminOnboardingUpdateDto }: {
    adminOnboardingUpdateDto: AdminOnboardingUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/system-metadata/admin-onboarding", oazapfts.json({
        ...opts,
        method: "POST",
        body: adminOnboardingUpdateDto
    })));
}
/**
 * Retrieve reverse geocoding state
 */
export function getReverseGeocodingState(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: ReverseGeocodingStateResponseDto;
    }>("/system-metadata/reverse-geocoding-state", {
        ...opts
    }));
}
/**
 * Retrieve version check state
 */
export function getVersionCheckState(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: VersionCheckStateResponseDto;
    }>("/system-metadata/version-check-state", {
        ...opts
    }));
}
/**
 * Retrieve tags
 */
export function getAllTags(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto[];
    }>("/tags", {
        ...opts
    }));
}
/**
 * Create a tag
 */
export function createTag({ tagCreateDto }: {
    tagCreateDto: TagCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: TagResponseDto;
    }>("/tags", oazapfts.json({
        ...opts,
        method: "POST",
        body: tagCreateDto
    })));
}
/**
 * Upsert tags
 */
export function upsertTags({ tagUpsertDto }: {
    tagUpsertDto: TagUpsertDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto[];
    }>("/tags", oazapfts.json({
        ...opts,
        method: "PUT",
        body: tagUpsertDto
    })));
}
/**
 * Tag assets
 */
export function bulkTagAssets({ tagBulkAssetsDto }: {
    tagBulkAssetsDto: TagBulkAssetsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagBulkAssetsResponseDto;
    }>("/tags/assets", oazapfts.json({
        ...opts,
        method: "PUT",
        body: tagBulkAssetsDto
    })));
}
/**
 * Delete a tag
 */
export function deleteTag({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/tags/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a tag
 */
export function getTagById({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto;
    }>(`/tags/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a tag
 */
export function updateTag({ id, tagUpdateDto }: {
    id: string;
    tagUpdateDto: TagUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TagResponseDto;
    }>(`/tags/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: tagUpdateDto
    })));
}
/**
 * Untag assets
 */
export function untagAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/tags/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "DELETE",
        body: bulkIdsDto
    })));
}
/**
 * Tag assets
 */
export function tagAssets({ id, bulkIdsDto }: {
    id: string;
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: BulkIdResponseDto[];
    }>(`/tags/${encodeURIComponent(id)}/assets`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: bulkIdsDto
    })));
}
/**
 * Get time bucket
 */
export function getTimeBucket({ albumId, bbox, isFavorite, isTrashed, key, order, orderBy, personId, slug, tagId, timeBucket, userId, visibility, withCoordinates, withPartners, withStacked }: {
    albumId?: string;
    bbox?: string;
    isFavorite?: boolean;
    isTrashed?: boolean;
    key?: string;
    order?: AssetOrder;
    orderBy?: AssetOrderBy;
    personId?: string;
    slug?: string;
    tagId?: string;
    timeBucket: string;
    userId?: string;
    visibility?: AssetVisibility;
    withCoordinates?: boolean;
    withPartners?: boolean;
    withStacked?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TimeBucketAssetResponseDto;
    }>(`/timeline/bucket${QS.query(QS.explode({
        albumId,
        bbox,
        isFavorite,
        isTrashed,
        key,
        order,
        orderBy,
        personId,
        slug,
        tagId,
        timeBucket,
        userId,
        visibility,
        withCoordinates,
        withPartners,
        withStacked
    }))}`, {
        ...opts
    }));
}
/**
 * Get time buckets
 */
export function getTimeBuckets({ albumId, bbox, isFavorite, isTrashed, key, order, orderBy, personId, slug, tagId, userId, visibility, withCoordinates, withPartners, withStacked }: {
    albumId?: string;
    bbox?: string;
    isFavorite?: boolean;
    isTrashed?: boolean;
    key?: string;
    order?: AssetOrder;
    orderBy?: AssetOrderBy;
    personId?: string;
    slug?: string;
    tagId?: string;
    userId?: string;
    visibility?: AssetVisibility;
    withCoordinates?: boolean;
    withPartners?: boolean;
    withStacked?: boolean;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TimeBucketsResponseDto[];
    }>(`/timeline/buckets${QS.query(QS.explode({
        albumId,
        bbox,
        isFavorite,
        isTrashed,
        key,
        order,
        orderBy,
        personId,
        slug,
        tagId,
        userId,
        visibility,
        withCoordinates,
        withPartners,
        withStacked
    }))}`, {
        ...opts
    }));
}
/**
 * Empty trash
 */
export function emptyTrash(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TrashResponseDto;
    }>("/trash/empty", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Restore trash
 */
export function restoreTrash(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TrashResponseDto;
    }>("/trash/restore", {
        ...opts,
        method: "POST"
    }));
}
/**
 * Restore assets
 */
export function restoreAssets({ bulkIdsDto }: {
    bulkIdsDto: BulkIdsDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: TrashResponseDto;
    }>("/trash/restore/assets", oazapfts.json({
        ...opts,
        method: "POST",
        body: bulkIdsDto
    })));
}
/**
 * Get all users
 */
export function searchUsers(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserResponseDto[];
    }>("/users", {
        ...opts
    }));
}
/**
 * Get current user
 */
export function getMyUser(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/users/me", {
        ...opts
    }));
}
/**
 * Update current user
 */
export function updateMyUser({ userUpdateMeDto }: {
    userUpdateMeDto: UserUpdateMeDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserAdminResponseDto;
    }>("/users/me", oazapfts.json({
        ...opts,
        method: "PUT",
        body: userUpdateMeDto
    })));
}
/**
 * Retrieve calendar heatmap activity
 */
export function getMyCalendarHeatmap({ $from, to, $type }: {
    $from?: string;
    to?: string;
    $type?: CalendarHeatmapType;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: CalendarHeatmapResponseDto;
    }>(`/users/me/calendar-heatmap${QS.query(QS.explode({
        "from": $from,
        to,
        "type": $type
    }))}`, {
        ...opts
    }));
}
/**
 * Delete user product key
 */
export function deleteUserLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/users/me/license", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve user product key
 */
export function getUserLicense(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    }>("/users/me/license", {
        ...opts
    }));
}
/**
 * Set user product key
 */
export function setUserLicense({ licenseKeyDto }: {
    licenseKeyDto: LicenseKeyDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserLicense;
    }>("/users/me/license", oazapfts.json({
        ...opts,
        method: "PUT",
        body: licenseKeyDto
    })));
}
/**
 * Delete user onboarding
 */
export function deleteUserOnboarding(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/users/me/onboarding", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve user onboarding
 */
export function getUserOnboarding(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: OnboardingResponseDto;
    }>("/users/me/onboarding", {
        ...opts
    }));
}
/**
 * Update user onboarding
 */
export function setUserOnboarding({ onboardingDto }: {
    onboardingDto: OnboardingDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: OnboardingResponseDto;
    }>("/users/me/onboarding", oazapfts.json({
        ...opts,
        method: "PUT",
        body: onboardingDto
    })));
}
/**
 * Get my preferences
 */
export function getMyPreferences(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>("/users/me/preferences", {
        ...opts
    }));
}
/**
 * Update my preferences
 */
export function updateMyPreferences({ userPreferencesUpdateDto }: {
    userPreferencesUpdateDto: UserPreferencesUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserPreferencesResponseDto;
    }>("/users/me/preferences", oazapfts.json({
        ...opts,
        method: "PUT",
        body: userPreferencesUpdateDto
    })));
}
/**
 * Delete user profile image
 */
export function deleteProfileImage(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText("/users/profile-image", {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Create user profile image
 */
export function createProfileImage({ createProfileImageDto }: {
    createProfileImageDto: CreateProfileImageDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: CreateProfileImageResponseDto;
    }>("/users/profile-image", oazapfts.multipart({
        ...opts,
        method: "POST",
        body: createProfileImageDto
    })));
}
/**
 * Retrieve a user
 */
export function getUser({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: UserResponseDto;
    }>(`/users/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Retrieve user profile image
 */
export function getProfileImage({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchBlob<{
        status: 200;
        data: Blob;
    }>(`/users/${encodeURIComponent(id)}/profile-image`, {
        ...opts
    }));
}
/**
 * Retrieve assets by original path
 */
export function getAssetsByOriginalPath({ path }: {
    path: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: AssetResponseDto[];
    }>(`/view/folder${QS.query(QS.explode({
        path
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve unique paths
 */
export function getUniqueOriginalPaths(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: string[];
    }>("/view/folder/unique-paths", {
        ...opts
    }));
}
/**
 * List all workflows
 */
export function searchWorkflows({ description, enabled, id, logging, name, trigger }: {
    description?: string;
    enabled?: boolean;
    id?: string;
    logging?: boolean;
    name?: string;
    trigger?: WorkflowTrigger;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowResponseDto[];
    }>(`/workflows${QS.query(QS.explode({
        description,
        enabled,
        id,
        logging,
        name,
        trigger
    }))}`, {
        ...opts
    }));
}
/**
 * Create a workflow
 */
export function createWorkflow({ workflowCreateDto }: {
    workflowCreateDto: WorkflowCreateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 201;
        data: WorkflowResponseDto;
    }>("/workflows", oazapfts.json({
        ...opts,
        method: "POST",
        body: workflowCreateDto
    })));
}
/**
 * List all workflow triggers
 */
export function getWorkflowTriggers(opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowTriggerResponseDto[];
    }>("/workflows/triggers", {
        ...opts
    }));
}
/**
 * Delete a workflow
 */
export function deleteWorkflow({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchText(`/workflows/${encodeURIComponent(id)}`, {
        ...opts,
        method: "DELETE"
    }));
}
/**
 * Retrieve a workflow
 */
export function getWorkflow({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowResponseDto;
    }>(`/workflows/${encodeURIComponent(id)}`, {
        ...opts
    }));
}
/**
 * Update a workflow
 */
export function updateWorkflow({ id, workflowUpdateDto }: {
    id: string;
    workflowUpdateDto: WorkflowUpdateDto;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowResponseDto;
    }>(`/workflows/${encodeURIComponent(id)}`, oazapfts.json({
        ...opts,
        method: "PUT",
        body: workflowUpdateDto
    })));
}
/**
 * Retrieve workflow logs
 */
export function getWorkflowLogs({ before, id, limit, result }: {
    before?: string;
    id: string;
    limit?: number;
    result?: WorkflowResult;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowLogEntryDto[];
    }>(`/workflows/${encodeURIComponent(id)}/logs${QS.query(QS.explode({
        before,
        limit,
        result
    }))}`, {
        ...opts
    }));
}
/**
 * Retrieve a workflow
 */
export function getWorkflowForShare({ id }: {
    id: string;
}, opts?: Oazapfts.RequestOpts) {
    return oazapfts.ok(oazapfts.fetchJson<{
        status: 200;
        data: WorkflowShareResponseDto;
    }>(`/workflows/${encodeURIComponent(id)}/share`, {
        ...opts
    }));
}
export enum ReactionLevel {
    Album = "album",
    Asset = "asset"
}
export enum ReactionType {
    Comment = "comment",
    Like = "like"
}
export enum UserAvatarColor {
    Primary = "primary",
    Pink = "pink",
    Red = "red",
    Yellow = "yellow",
    Blue = "blue",
    Green = "green",
    Purple = "purple",
    Orange = "orange",
    Gray = "gray",
    Amber = "amber"
}
export enum DefaultStyle {
    Sketch = "sketch",
    Watercolor = "watercolor",
    Toner = "toner",
    Terrain = "terrain"
}
export enum TranscodeHWAccel {
    Nvenc = "nvenc",
    Qsv = "qsv",
    Vaapi = "vaapi",
    Rkmpp = "rkmpp",
    Disabled = "disabled"
}
export enum AudioCodec {
    Mp3 = "mp3",
    Aac = "aac",
    Opus = "opus",
    PcmS16Le = "pcm_s16le"
}
export enum VideoContainer {
    Mov = "mov",
    Mp4 = "mp4",
    Ogg = "ogg",
    Webm = "webm"
}
export enum VideoCodec {
    H264 = "h264",
    Hevc = "hevc",
    Vp9 = "vp9",
    Av1 = "av1"
}
export enum CQMode {
    Auto = "auto",
    Cqp = "cqp",
    Icq = "icq"
}
export enum HlsVideoResolution {
    $480 = 480,
    $720 = 720,
    $1080 = 1080,
    $1440 = 1440,
    $2160 = 2160
}
export enum ToneMapping {
    Hable = "hable",
    Mobius = "mobius",
    Reinhard = "reinhard",
    Disabled = "disabled"
}
export enum TranscodePolicy {
    All = "all",
    Optimal = "optimal",
    Bitrate = "bitrate",
    Required = "required",
    Disabled = "disabled"
}
export enum Colorspace {
    Srgb = "srgb",
    P3 = "p3"
}
export enum ImageFormat {
    Jpeg = "jpeg",
    Webp = "webp"
}
export enum LogLevel {
    Verbose = "verbose",
    Debug = "debug",
    Log = "log",
    Warn = "warn",
    Error = "error",
    Fatal = "fatal"
}
export enum ReleaseChannel {
    Stable = "stable",
    ReleaseCandidate = "releaseCandidate"
}
export enum OAuthTokenEndpointAuthMethod {
    ClientSecretPost = "client_secret_post",
    ClientSecretBasic = "client_secret_basic"
}
export enum IntegrityReport {
    UntrackedFile = "untracked_file",
    MissingFile = "missing_file",
    ChecksumMismatch = "checksum_mismatch"
}
export enum MaintenanceAction {
    Start = "start",
    End = "end",
    SelectDatabaseRestore = "select_database_restore",
    RestoreDatabase = "restore_database"
}
export enum StorageFolder {
    EncodedVideo = "encoded-video",
    Library = "library",
    Upload = "upload",
    Profile = "profile",
    Thumbs = "thumbs",
    Backups = "backups"
}
export enum NotificationLevel {
    Success = "success",
    Error = "error",
    Warning = "warning",
    Info = "info"
}
export enum NotificationType {
    JobFailed = "JobFailed",
    BackupFailed = "BackupFailed",
    SystemMessage = "SystemMessage",
    AlbumInvite = "AlbumInvite",
    AlbumUpdate = "AlbumUpdate",
    ClusterGroupRequest = "ClusterGroupRequest",
    Custom = "Custom"
}
export enum UserStatus {
    Active = "active",
    Removing = "removing",
    Deleted = "deleted"
}
export enum CalendarHeatmapType {
    Upload = "Upload",
    Taken = "Taken"
}
export enum AssetOrder {
    Asc = "asc",
    Desc = "desc"
}
export enum AssetVisibility {
    Archive = "archive",
    Timeline = "timeline",
    Hidden = "hidden",
    Locked = "locked"
}
export enum AgentSessionStatus {
    Idle = "idle",
    Running = "running",
    Error = "error"
}
export enum Kind {
    AllowOnce = "allow_once",
    AllowAlways = "allow_always",
    RejectOnce = "reject_once",
    RejectAlways = "reject_always"
}
export enum AgentMessageKind {
    Text = "text",
    Thought = "thought",
    ToolCall = "tool_call",
    Permission = "permission",
    Plan = "plan",
    Error = "error"
}
export enum AgentMessageRole {
    User = "user",
    Agent = "agent"
}
export enum AlbumUserRole {
    Editor = "editor",
    Owner = "owner",
    Viewer = "viewer"
}
export enum BulkIdErrorReason {
    Duplicate = "duplicate",
    NoPermission = "no_permission",
    NotFound = "not_found",
    Unknown = "unknown",
    Validation = "validation"
}
export enum Permission {
    All = "all",
    ActivityCreate = "activity.create",
    ActivityRead = "activity.read",
    ActivityUpdate = "activity.update",
    ActivityDelete = "activity.delete",
    ActivityStatistics = "activity.statistics",
    AgentSessionCreate = "agentSession.create",
    AgentSessionRead = "agentSession.read",
    AgentSessionUpdate = "agentSession.update",
    AgentSessionDelete = "agentSession.delete",
    ArtJobCreate = "artJob.create",
    ArtJobRead = "artJob.read",
    ApiKeyCreate = "apiKey.create",
    ApiKeyRead = "apiKey.read",
    ApiKeyUpdate = "apiKey.update",
    ApiKeyDelete = "apiKey.delete",
    ApiKeyRotate = "apiKey.rotate",
    AssetRead = "asset.read",
    AssetUpdate = "asset.update",
    AssetDelete = "asset.delete",
    AssetStatistics = "asset.statistics",
    AssetShare = "asset.share",
    AssetView = "asset.view",
    AssetDownload = "asset.download",
    AssetUpload = "asset.upload",
    AssetCopy = "asset.copy",
    AssetDerive = "asset.derive",
    AssetFileRead = "assetFile.read",
    AssetFileDelete = "assetFile.delete",
    AssetFileDownload = "assetFile.download",
    AssetEditGet = "asset.edit.get",
    AssetEditCreate = "asset.edit.create",
    AssetEditDelete = "asset.edit.delete",
    AlbumCreate = "album.create",
    AlbumRead = "album.read",
    AlbumUpdate = "album.update",
    AlbumDelete = "album.delete",
    AlbumStatistics = "album.statistics",
    AlbumShare = "album.share",
    AlbumDownload = "album.download",
    AlbumAssetCreate = "albumAsset.create",
    AlbumAssetDelete = "albumAsset.delete",
    AlbumUserCreate = "albumUser.create",
    AlbumUserUpdate = "albumUser.update",
    AlbumUserDelete = "albumUser.delete",
    AuthChangePassword = "auth.changePassword",
    AuthDeviceDelete = "authDevice.delete",
    ArchiveRead = "archive.read",
    BackupList = "backup.list",
    BackupDownload = "backup.download",
    BackupUpload = "backup.upload",
    BackupDelete = "backup.delete",
    BookCreate = "book.create",
    BookRead = "book.read",
    BookUpdate = "book.update",
    BookDelete = "book.delete",
    BookDownload = "book.download",
    ClusterGroupRead = "clusterGroup.read",
    ClusterGroupLeave = "clusterGroup.leave",
    ClusterGroupRequestCreate = "clusterGroupRequest.create",
    ClusterGroupRequestRead = "clusterGroupRequest.read",
    ClusterGroupRequestDelete = "clusterGroupRequest.delete",
    AdminConfigRead = "adminConfig.read",
    AdminConfigUpdate = "adminConfig.update",
    UserConfigRead = "userConfig.read",
    DuplicateRead = "duplicate.read",
    DuplicateDelete = "duplicate.delete",
    FaceCreate = "face.create",
    FaceRead = "face.read",
    FaceUpdate = "face.update",
    FaceDelete = "face.delete",
    FolderRead = "folder.read",
    JobCreate = "job.create",
    JobRead = "job.read",
    LibraryCreate = "library.create",
    LibraryRead = "library.read",
    LibraryUpdate = "library.update",
    LibraryDelete = "library.delete",
    LibraryStatistics = "library.statistics",
    TimelineRead = "timeline.read",
    TimelineDownload = "timeline.download",
    Maintenance = "maintenance",
    MapRead = "map.read",
    MapSearch = "map.search",
    MemoryCreate = "memory.create",
    MemoryRead = "memory.read",
    MemoryUpdate = "memory.update",
    MemoryDelete = "memory.delete",
    MemoryStatistics = "memory.statistics",
    MemoryAssetCreate = "memoryAsset.create",
    MemoryAssetDelete = "memoryAsset.delete",
    NotificationCreate = "notification.create",
    NotificationRead = "notification.read",
    NotificationUpdate = "notification.update",
    NotificationDelete = "notification.delete",
    PartnerCreate = "partner.create",
    PartnerRead = "partner.read",
    PartnerUpdate = "partner.update",
    PartnerDelete = "partner.delete",
    PersonCreate = "person.create",
    PersonRead = "person.read",
    PersonUpdate = "person.update",
    PersonDelete = "person.delete",
    PersonStatistics = "person.statistics",
    PersonMerge = "person.merge",
    PersonReassign = "person.reassign",
    PinCodeCreate = "pinCode.create",
    PinCodeUpdate = "pinCode.update",
    PinCodeDelete = "pinCode.delete",
    PluginCreate = "plugin.create",
    PluginRead = "plugin.read",
    PluginUpdate = "plugin.update",
    PluginDelete = "plugin.delete",
    ServerAbout = "server.about",
    ServerApkLinks = "server.apkLinks",
    ServerStorage = "server.storage",
    ServerStatistics = "server.statistics",
    ServerVersionCheck = "server.versionCheck",
    ServerLicenseRead = "serverLicense.read",
    ServerLicenseUpdate = "serverLicense.update",
    ServerLicenseDelete = "serverLicense.delete",
    SessionCreate = "session.create",
    SessionRead = "session.read",
    SessionUpdate = "session.update",
    SessionDelete = "session.delete",
    SessionLock = "session.lock",
    SharedLinkCreate = "sharedLink.create",
    SharedLinkRead = "sharedLink.read",
    SharedLinkUpdate = "sharedLink.update",
    SharedLinkDelete = "sharedLink.delete",
    StackCreate = "stack.create",
    StackRead = "stack.read",
    StackUpdate = "stack.update",
    StackDelete = "stack.delete",
    SyncStream = "sync.stream",
    SyncCheckpointRead = "syncCheckpoint.read",
    SyncCheckpointUpdate = "syncCheckpoint.update",
    SyncCheckpointDelete = "syncCheckpoint.delete",
    SystemConfigRead = "systemConfig.read",
    SystemConfigUpdate = "systemConfig.update",
    SystemMetadataRead = "systemMetadata.read",
    SystemMetadataUpdate = "systemMetadata.update",
    TagCreate = "tag.create",
    TagRead = "tag.read",
    TagUpdate = "tag.update",
    TagDelete = "tag.delete",
    TagAsset = "tag.asset",
    UserRead = "user.read",
    UserUpdate = "user.update",
    UserLicenseCreate = "userLicense.create",
    UserLicenseRead = "userLicense.read",
    UserLicenseUpdate = "userLicense.update",
    UserLicenseDelete = "userLicense.delete",
    UserOnboardingRead = "userOnboarding.read",
    UserOnboardingUpdate = "userOnboarding.update",
    UserOnboardingDelete = "userOnboarding.delete",
    UserPreferenceRead = "userPreference.read",
    UserPreferenceUpdate = "userPreference.update",
    UserProfileImageCreate = "userProfileImage.create",
    UserProfileImageRead = "userProfileImage.read",
    UserProfileImageUpdate = "userProfileImage.update",
    UserProfileImageDelete = "userProfileImage.delete",
    QueueRead = "queue.read",
    QueueUpdate = "queue.update",
    QueueJobCreate = "queueJob.create",
    QueueJobRead = "queueJob.read",
    QueueJobUpdate = "queueJob.update",
    QueueJobDelete = "queueJob.delete",
    WorkflowCreate = "workflow.create",
    WorkflowRead = "workflow.read",
    WorkflowUpdate = "workflow.update",
    WorkflowDelete = "workflow.delete",
    WorkflowLogs = "workflow.logs",
    AdminUserCreate = "adminUser.create",
    AdminUserRead = "adminUser.read",
    AdminUserUpdate = "adminUser.update",
    AdminUserDelete = "adminUser.delete",
    AdminSessionRead = "adminSession.read",
    AdminAuthUnlinkAll = "adminAuth.unlinkAll"
}
export enum ArtJobStatus {
    Pending = "pending",
    Running = "running",
    Completed = "completed",
    Failed = "failed"
}
export enum AssetFileType {
    Fullsize = "fullsize",
    Preview = "preview",
    Thumbnail = "thumbnail",
    Sidecar = "sidecar",
    EncodedVideo = "encoded_video"
}
export enum AssetMediaStatus {
    Created = "created",
    Duplicate = "duplicate"
}
export enum AssetUploadAction {
    Accept = "accept",
    Reject = "reject"
}
export enum AssetRejectReason {
    Duplicate = "duplicate",
    UnsupportedFormat = "unsupported-format"
}
export enum AssetJobName {
    RefreshFaces = "refresh-faces",
    RefreshMetadata = "refresh-metadata",
    RegenerateThumbnail = "regenerate-thumbnail",
    TranscodeVideo = "transcode-video"
}
export enum AssetTypeEnum {
    Image = "IMAGE",
    Video = "VIDEO",
    Audio = "AUDIO",
    Other = "OTHER"
}
export enum AssetEditAction {
    Crop = "crop",
    Rotate = "rotate",
    Mirror = "mirror"
}
export enum MirrorAxis {
    Horizontal = "horizontal",
    Vertical = "vertical"
}
export enum EnhanceCorrectionType {
    Denoise = "denoise",
    WhiteBalance = "whiteBalance",
    Levels = "levels",
    Exposure = "exposure",
    LocalContrast = "localContrast",
    Saturation = "saturation",
    Sharpen = "sharpen"
}
export enum EnhanceStrength {
    Subtle = "subtle",
    Normal = "normal",
    Strong = "strong"
}
export enum AssetMediaSize {
    Original = "original",
    Fullsize = "fullsize",
    Preview = "preview",
    Thumbnail = "thumbnail"
}
export enum BookExportStatus {
    Pending = "pending",
    Running = "running",
    Completed = "completed",
    Failed = "failed"
}
export enum BookStyleTheme {
    Plain = "plain",
    Food = "food",
    Gallery = "gallery",
    Wine = "wine",
    Cookbook = "cookbook",
    Travel = "travel"
}
export enum BookStylePreset {
    Classic = "classic",
    Soft = "soft",
    Bold = "bold",
    Food = "food",
    Museum = "museum",
    Wine = "wine",
    Cookbook = "cookbook",
    Travel = "travel"
}
export enum BookMapStyle {
    Sketch = "sketch",
    Watercolor = "watercolor",
    Toner = "toner",
    Terrain = "terrain"
}
export enum BookCaptionMode {
    None = "none",
    Place = "place",
    PlaceTime = "place-time",
    People = "people",
    Dish = "dish"
}
export enum BookMapStyleOption {
    Auto = "auto",
    Sketch = "sketch",
    Watercolor = "watercolor",
    Toner = "toner",
    Terrain = "terrain"
}
export enum Orientation {
    Any = "any",
    Landscape = "landscape",
    Portrait = "portrait"
}
export enum Kind2 {
    Title = "title",
    Subtitle = "subtitle",
    SectionTitle = "sectionTitle",
    Caption = "caption",
    SlotCaption = "slotCaption"
}
export enum BookExportFormat {
    Pdf = "pdf",
    Html = "html"
}
export enum Severity {
    High = "high",
    Medium = "medium",
    Low = "low"
}
export enum Type {
    DuplicateStack = "duplicate-stack",
    LowDpi = "low-dpi",
    EmptySlot = "empty-slot",
    TooMuchArtwork = "too-much-artwork",
    ArtworkBackToBack = "artwork-back-to-back",
    SinglesInARow = "singles-in-a-row",
    SimilarNeighbours = "similar-neighbours",
    MapStyleFallback = "map-style-fallback",
    PersonUnderrepresented = "person-underrepresented",
    TooManyPairs = "too-many-pairs",
    RepeatedLayout = "repeated-layout",
    MissingCaptions = "missing-captions",
    CouldLookBetter = "could-look-better",
    MissingDishName = "missing-dish-name",
    MissingMenuPage = "missing-menu-page"
}
export enum CollectionPlaceSource {
    Tag = "tag",
    Sign = "sign",
    Source = "source",
    Receipt = "receipt",
    Fallback = "fallback"
}
export enum SourceType {
    MachineLearning = "machine-learning",
    Exif = "exif",
    Manual = "manual"
}
export enum FoodRestaurantSource {
    Tag = "tag",
    Sign = "sign",
    Menu = "menu",
    Receipt = "receipt",
    Fallback = "fallback"
}
export enum FoodMealType {
    Breakfast = "Breakfast",
    Lunch = "Lunch",
    Dinner = "Dinner"
}
export enum ManualJobName {
    PersonCleanup = "person-cleanup",
    TagCleanup = "tag-cleanup",
    UserCleanup = "user-cleanup",
    MemoryCleanup = "memory-cleanup",
    MemoryCreate = "memory-create",
    BackupDatabase = "backup-database",
    IntegrityMissingFiles = "integrity-missing-files",
    IntegrityUntrackedFiles = "integrity-untracked-files",
    IntegrityChecksumMismatch = "integrity-checksum-mismatch",
    IntegrityMissingFilesRefresh = "integrity-missing-files-refresh",
    IntegrityUntrackedFilesRefresh = "integrity-untracked-files-refresh",
    IntegrityChecksumMismatchRefresh = "integrity-checksum-mismatch-refresh",
    IntegrityMissingFilesDeleteAll = "integrity-missing-files-delete-all",
    IntegrityUntrackedFilesDeleteAll = "integrity-untracked-files-delete-all",
    IntegrityChecksumMismatchDeleteAll = "integrity-checksum-mismatch-delete-all"
}
export enum QueueName {
    ThumbnailGeneration = "thumbnailGeneration",
    MetadataExtraction = "metadataExtraction",
    VideoConversion = "videoConversion",
    FaceDetection = "faceDetection",
    FacialRecognition = "facialRecognition",
    SmartSearch = "smartSearch",
    DuplicateDetection = "duplicateDetection",
    BackgroundTask = "backgroundTask",
    StorageTemplateMigration = "storageTemplateMigration",
    Migration = "migration",
    Search = "search",
    Sidecar = "sidecar",
    Library = "library",
    Notifications = "notifications",
    BackupDatabase = "backupDatabase",
    Ocr = "ocr",
    Workflow = "workflow",
    IntegrityCheck = "integrityCheck",
    Editor = "editor"
}
export enum QueueCommand {
    Start = "start",
    Pause = "pause",
    Resume = "resume",
    Empty = "empty",
    ClearFailed = "clear-failed"
}
export enum MemorySearchOrder {
    Asc = "asc",
    Desc = "desc",
    Random = "random"
}
export enum MemoryType {
    OnThisDay = "on_this_day",
    Birthday = "birthday"
}
export enum PartnerDirection {
    SharedBy = "shared-by",
    SharedWith = "shared-with"
}
export enum WorkflowType {
    AssetV1 = "AssetV1"
}
export enum WorkflowTrigger {
    AssetCreate = "AssetCreate",
    AssetMetadataExtraction = "AssetMetadataExtraction",
    AssetTagged = "AssetTagged"
}
export enum QueueJobStatus {
    Active = "active",
    Failed = "failed",
    Completed = "completed",
    Delayed = "delayed",
    Waiting = "waiting",
    Paused = "paused"
}
export enum JobName {
    AssetDelete = "AssetDelete",
    AssetDeleteCheck = "AssetDeleteCheck",
    AssetDetectFacesQueueAll = "AssetDetectFacesQueueAll",
    AssetDetectFaces = "AssetDetectFaces",
    AssetDetectDuplicatesQueueAll = "AssetDetectDuplicatesQueueAll",
    AssetDetectDuplicates = "AssetDetectDuplicates",
    AssetEditThumbnailGeneration = "AssetEditThumbnailGeneration",
    AssetEncodeVideoQueueAll = "AssetEncodeVideoQueueAll",
    AssetEncodeVideo = "AssetEncodeVideo",
    AssetEmptyTrash = "AssetEmptyTrash",
    AssetExtractMetadataQueueAll = "AssetExtractMetadataQueueAll",
    AssetExtractMetadata = "AssetExtractMetadata",
    AssetFileMigration = "AssetFileMigration",
    AssetGenerateThumbnailsQueueAll = "AssetGenerateThumbnailsQueueAll",
    AssetGenerateThumbnails = "AssetGenerateThumbnails",
    AuditTableCleanup = "AuditTableCleanup",
    BookExport = "BookExport",
    BookExportHtml = "BookExportHtml",
    DatabaseBackup = "DatabaseBackup",
    FacialRecognitionQueueAll = "FacialRecognitionQueueAll",
    FacialRecognition = "FacialRecognition",
    FileDelete = "FileDelete",
    FileMigrationQueueAll = "FileMigrationQueueAll",
    LibraryDeleteCheck = "LibraryDeleteCheck",
    LibraryDelete = "LibraryDelete",
    LibraryRemoveAsset = "LibraryRemoveAsset",
    LibraryScanAssetsQueueAll = "LibraryScanAssetsQueueAll",
    LibrarySyncAssets = "LibrarySyncAssets",
    LibrarySyncFilesQueueAll = "LibrarySyncFilesQueueAll",
    LibrarySyncFiles = "LibrarySyncFiles",
    LibraryScanQueueAll = "LibraryScanQueueAll",
    HlsSessionCleanup = "HlsSessionCleanup",
    MemoryCleanup = "MemoryCleanup",
    MemoryGenerate = "MemoryGenerate",
    NotificationsCleanup = "NotificationsCleanup",
    NotifyUserSignup = "NotifyUserSignup",
    NotifyAlbumInvite = "NotifyAlbumInvite",
    NotifyAlbumUpdate = "NotifyAlbumUpdate",
    UserDelete = "UserDelete",
    UserDeleteCheck = "UserDeleteCheck",
    UserSyncUsage = "UserSyncUsage",
    PersonCleanup = "PersonCleanup",
    PersonFileMigration = "PersonFileMigration",
    PersonGenerateThumbnail = "PersonGenerateThumbnail",
    SessionCleanup = "SessionCleanup",
    SendMail = "SendMail",
    SidecarQueueAll = "SidecarQueueAll",
    SidecarCheck = "SidecarCheck",
    SidecarWrite = "SidecarWrite",
    SmartSearchQueueAll = "SmartSearchQueueAll",
    SmartSearch = "SmartSearch",
    StorageTemplateMigration = "StorageTemplateMigration",
    StorageTemplateMigrationSingle = "StorageTemplateMigrationSingle",
    TagCleanup = "TagCleanup",
    VersionCheck = "VersionCheck",
    OcrQueueAll = "OcrQueueAll",
    Ocr = "Ocr",
    WorkflowAssetTrigger = "WorkflowAssetTrigger",
    IntegrityUntrackedFilesQueueAll = "IntegrityUntrackedFilesQueueAll",
    IntegrityUntrackedFiles = "IntegrityUntrackedFiles",
    IntegrityUntrackedRefresh = "IntegrityUntrackedRefresh",
    IntegrityMissingFilesQueueAll = "IntegrityMissingFilesQueueAll",
    IntegrityMissingFiles = "IntegrityMissingFiles",
    IntegrityMissingFilesRefresh = "IntegrityMissingFilesRefresh",
    IntegrityChecksumFiles = "IntegrityChecksumFiles",
    IntegrityChecksumFilesRefresh = "IntegrityChecksumFilesRefresh",
    IntegrityDeleteReportType = "IntegrityDeleteReportType",
    IntegrityDeleteReports = "IntegrityDeleteReports"
}
export enum SearchOrderField {
    FileCreatedAt = "fileCreatedAt",
    LocalDateTime = "localDateTime",
    FileSizeInBytes = "fileSizeInBytes",
    Rating = "rating"
}
export enum SearchSuggestionType {
    Country = "country",
    State = "state",
    City = "city",
    CameraMake = "camera-make",
    CameraModel = "camera-model",
    CameraLensModel = "camera-lens-model"
}
export enum SharedLinkType {
    Album = "ALBUM",
    Individual = "INDIVIDUAL"
}
export enum AssetIdErrorReason {
    Duplicate = "duplicate",
    NoPermission = "no_permission",
    NotFound = "not_found"
}
export enum SyncEntityType {
    AuthUserV1 = "AuthUserV1",
    AuthUserV2 = "AuthUserV2",
    UserV1 = "UserV1",
    UserDeleteV1 = "UserDeleteV1",
    AssetV1 = "AssetV1",
    AssetV2 = "AssetV2",
    AssetDeleteV1 = "AssetDeleteV1",
    AssetExifV1 = "AssetExifV1",
    AssetEditV1 = "AssetEditV1",
    AssetEditDeleteV1 = "AssetEditDeleteV1",
    AssetMetadataV1 = "AssetMetadataV1",
    AssetMetadataDeleteV1 = "AssetMetadataDeleteV1",
    AssetOcrV1 = "AssetOcrV1",
    AssetOcrDeleteV1 = "AssetOcrDeleteV1",
    PartnerV1 = "PartnerV1",
    PartnerDeleteV1 = "PartnerDeleteV1",
    PartnerAssetV1 = "PartnerAssetV1",
    PartnerAssetV2 = "PartnerAssetV2",
    PartnerAssetBackfillV1 = "PartnerAssetBackfillV1",
    PartnerAssetBackfillV2 = "PartnerAssetBackfillV2",
    PartnerAssetDeleteV1 = "PartnerAssetDeleteV1",
    PartnerAssetExifV1 = "PartnerAssetExifV1",
    PartnerAssetExifBackfillV1 = "PartnerAssetExifBackfillV1",
    PartnerStackBackfillV1 = "PartnerStackBackfillV1",
    PartnerStackDeleteV1 = "PartnerStackDeleteV1",
    PartnerStackV1 = "PartnerStackV1",
    AlbumV1 = "AlbumV1",
    AlbumV2 = "AlbumV2",
    AlbumDeleteV1 = "AlbumDeleteV1",
    AlbumUserV1 = "AlbumUserV1",
    AlbumUserBackfillV1 = "AlbumUserBackfillV1",
    AlbumUserDeleteV1 = "AlbumUserDeleteV1",
    AlbumAssetCreateV1 = "AlbumAssetCreateV1",
    AlbumAssetCreateV2 = "AlbumAssetCreateV2",
    AlbumAssetUpdateV1 = "AlbumAssetUpdateV1",
    AlbumAssetUpdateV2 = "AlbumAssetUpdateV2",
    AlbumAssetBackfillV1 = "AlbumAssetBackfillV1",
    AlbumAssetBackfillV2 = "AlbumAssetBackfillV2",
    AlbumAssetExifCreateV1 = "AlbumAssetExifCreateV1",
    AlbumAssetExifUpdateV1 = "AlbumAssetExifUpdateV1",
    AlbumAssetExifBackfillV1 = "AlbumAssetExifBackfillV1",
    AlbumToAssetV1 = "AlbumToAssetV1",
    AlbumToAssetDeleteV1 = "AlbumToAssetDeleteV1",
    AlbumToAssetBackfillV1 = "AlbumToAssetBackfillV1",
    MemoryV1 = "MemoryV1",
    MemoryDeleteV1 = "MemoryDeleteV1",
    MemoryToAssetV1 = "MemoryToAssetV1",
    MemoryToAssetDeleteV1 = "MemoryToAssetDeleteV1",
    StackV1 = "StackV1",
    StackDeleteV1 = "StackDeleteV1",
    PersonV1 = "PersonV1",
    PersonDeleteV1 = "PersonDeleteV1",
    AssetFaceV1 = "AssetFaceV1",
    AssetFaceV2 = "AssetFaceV2",
    AssetFaceV3 = "AssetFaceV3",
    AssetFaceDeleteV1 = "AssetFaceDeleteV1",
    UserMetadataV1 = "UserMetadataV1",
    UserMetadataDeleteV1 = "UserMetadataDeleteV1",
    SyncAckV1 = "SyncAckV1",
    SyncResetV1 = "SyncResetV1",
    SyncCompleteV1 = "SyncCompleteV1"
}
export enum SyncRequestType {
    AlbumsV1 = "AlbumsV1",
    AlbumsV2 = "AlbumsV2",
    AlbumUsersV1 = "AlbumUsersV1",
    AlbumToAssetsV1 = "AlbumToAssetsV1",
    AlbumAssetsV1 = "AlbumAssetsV1",
    AlbumAssetsV2 = "AlbumAssetsV2",
    AlbumAssetExifsV1 = "AlbumAssetExifsV1",
    AssetsV1 = "AssetsV1",
    AssetsV2 = "AssetsV2",
    AssetExifsV1 = "AssetExifsV1",
    AssetEditsV1 = "AssetEditsV1",
    AssetMetadataV1 = "AssetMetadataV1",
    AssetOcrV1 = "AssetOcrV1",
    AuthUsersV1 = "AuthUsersV1",
    AuthUsersV2 = "AuthUsersV2",
    MemoriesV1 = "MemoriesV1",
    MemoryToAssetsV1 = "MemoryToAssetsV1",
    PartnersV1 = "PartnersV1",
    PartnerAssetsV1 = "PartnerAssetsV1",
    PartnerAssetsV2 = "PartnerAssetsV2",
    PartnerAssetExifsV1 = "PartnerAssetExifsV1",
    PartnerStacksV1 = "PartnerStacksV1",
    StacksV1 = "StacksV1",
    UsersV1 = "UsersV1",
    PeopleV1 = "PeopleV1",
    AssetFacesV1 = "AssetFacesV1",
    AssetFacesV2 = "AssetFacesV2",
    AssetFacesV3 = "AssetFacesV3",
    UserMetadataV1 = "UserMetadataV1"
}
export enum AssetOrderBy {
    TakenAt = "takenAt",
    CreatedAt = "createdAt"
}
export enum WorkflowResult {
    Completed = "completed",
    Halted = "halted",
    Error = "error"
}
export enum ReleaseType {
    Major = "major",
    Premajor = "premajor",
    Minor = "minor",
    Preminor = "preminor",
    Patch = "patch",
    Prepatch = "prepatch",
    Prerelease = "prerelease"
}
export enum UserMetadataKey {
    Preferences = "preferences",
    License = "license",
    Onboarding = "onboarding"
}
