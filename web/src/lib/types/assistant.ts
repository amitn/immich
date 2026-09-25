// TODO: replace with @immich/sdk once the open-api spec is regenerated
//
// Local mirrors of the server DTOs for the AI assistant, photo books and artistic styles.
// The names and fields match the server DTOs exactly, so swapping to the generated SDK types
// only requires changing the imports.

// ---------------------------------------------------------------------------------------------
// Assistant (/api/agent/...)
// ---------------------------------------------------------------------------------------------

export type AgentSessionStatus = 'idle' | 'running' | 'error';

export type AgentSessionCreateDto = {
  title?: string;
  autoApprove?: boolean;
};

export type AgentSessionUpdateDto = {
  title?: string;
  autoApprove?: boolean;
};

export type AgentSessionResponseDto = {
  id: string;
  title: string | null;
  profile: string;
  status: AgentSessionStatus;
  /** changes to the library run without asking in this session */
  autoApprove: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AgentSessionDetailResponseDto = AgentSessionResponseDto & {
  /** oldest first */
  messages: AgentMessageDto[];
};

export type AgentPromptDto = {
  text: string;
  assetIds?: string[];
};

export type AgentPermissionResponseDto = {
  optionId?: string;
  approved?: boolean;
};

export type AgentMessageRole = 'user' | 'agent';

export type AgentMessageKind = 'text' | 'thought' | 'tool_call' | 'permission' | 'plan' | 'error';

export type AgentToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export type AgentPermissionStatus = 'pending' | 'approved' | 'denied' | 'expired';

export type AgentPermissionOptionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export type AgentPermissionOptionDto = {
  optionId: string;
  name: string;
  kind: AgentPermissionOptionKind;
};

export type AgentPlanEntryDto = {
  content: string;
  priority: string;
  status: string;
};

/** Flat content shape; which fields are set depends on the message kind */
export type AgentMessageContentDto = {
  /** markdown for agent text */
  text?: string;
  assetIds?: string[];
  albumIds?: string[];
  bookIds?: string[];
  toolCallId?: string;
  toolName?: string;
  title?: string;
  /** tool call: AgentToolCallStatus, permission: AgentPermissionStatus */
  status?: AgentToolCallStatus | AgentPermissionStatus;
  input?: unknown;
  output?: string;
  /** human summary of a permission request */
  summary?: string;
  requestId?: string;
  options?: AgentPermissionOptionDto[];
  /** plan entries */
  entries?: AgentPlanEntryDto[];
};

export type AgentMessageDto = {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  kind: AgentMessageKind;
  content: AgentMessageContentDto;
  createdAt: string;
};

/** Payload of the `on_agent_update` websocket event */
export type AgentUpdateDto = {
  sessionId: string;
  status: AgentSessionStatus;
  message?: AgentMessageDto;
};

// ---------------------------------------------------------------------------------------------
// Photo books (/api/books/...)
// ---------------------------------------------------------------------------------------------

export type BookExportStatus = 'pending' | 'running' | 'completed' | 'failed';

export type BookExportFormat = 'pdf' | 'html';

/** Styles of the artistic map pages; `sketch` is drawn offline, the others use Stadia Maps tiles */
export type BookMapStyle = 'sketch' | 'watercolor' | 'toner' | 'terrain';

/** `auto` lets the server pick: the admin default, or `sketch` without a Stadia Maps key */
export type BookMapStyleOption = 'auto' | BookMapStyle;

export type NormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BookStyle = {
  marginMm: number;
  gutterMm: number;
  background: string;
  textColor: string;
  fontFamily: string;
};

export type BookPageSlotDto = {
  slot: number;
  assetId: string;
  crop?: NormalizedRect | null;
  caption?: string | null;
};

export type BookMapDto = {
  style: BookMapStyle;
  title?: string;
  /** the photos whose locations are drawn; all photos of the book if omitted */
  assetIds?: string[];
  showRoute: boolean;
  labels: boolean;
  /** set while or after the map is illustrated by the art agent */
  artJobId?: string;
  illustratedAssetId?: string;
};

/** BookPageResponseDto on the server */
export type BookPageDto = {
  id: string;
  position: number;
  /** e.g. `full`, `grid-4`, `map`, `map-photo` */
  layout: string;
  sectionTitle: string | null;
  caption: string | null;
  slots: BookPageSlotDto[];
  /** set on map pages (layouts `map` and `map-photo`) */
  map: BookMapDto | null;
};

export type BookResponseDto = {
  id: string;
  title: string;
  subtitle: string | null;
  albumId: string | null;
  coverAssetId?: string | null;
  pageWidthMm: number;
  pageHeightMm: number;
  style: BookStyle;
  /** status of the PDF export */
  exportStatus: BookExportStatus | null;
  /** status of the single-file HTML export */
  htmlExportStatus: BookExportStatus | null;
  /** may be omitted by the list endpoint */
  pages?: BookPageDto[];
  createdAt: string;
  updatedAt: string;
};

export type BookDetailResponseDto = BookResponseDto & {
  pages: BookPageDto[];
};

export type BookCreateDto = {
  title: string;
  subtitle?: string;
  albumId?: string;
  pageWidthMm?: number;
  pageHeightMm?: number;
  style?: Partial<BookStyle>;
};

export type BookUpdateDto = Partial<BookCreateDto>;

/** Creates a book from an album and lays it out automatically */
export type BookFromAlbumDto = {
  albumId: string;
  title?: string;
  subtitle?: string;
  pageWidthMm?: number;
  pageHeightMm?: number;
  style?: Partial<BookStyle>;
  targetPageCount?: number;
  /** default true */
  includeMaps?: boolean;
  mapStyle?: BookMapStyleOption;
  /** illustrate the map pages with the art agent; default false */
  illustratedMaps?: boolean;
};

export type BookAutoLayoutDto = {
  assetIds?: string[];
  targetPageCount?: number;
  includeMaps?: boolean;
  mapStyle?: BookMapStyleOption;
  illustratedMaps?: boolean;
  heroAssetIds?: string[];
  keepExisting?: boolean;
};

export type BookExportDto = {
  /** default pdf */
  format?: BookExportFormat;
};

/** `books` section of the system config; not in the SDK's SystemConfigDto yet */
export type SystemConfigBooksDto = {
  maps: {
    stadiaApiKey: string;
    defaultStyle: BookMapStyle;
  };
};

// ---------------------------------------------------------------------------------------------
// Artistic styles (/api/art/...)
// ---------------------------------------------------------------------------------------------

export type ArtStyleDto = {
  id: string;
  name: string;
  description: string;
  usesCaption: boolean;
};

export type ArtJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export type ArtJobCreateDto = {
  assetId: string;
  style?: string;
  prompt?: string;
  caption?: string;
};

export type ArtJobResponseDto = {
  id: string;
  sourceAssetId: string;
  resultAssetId: string | null;
  style: string | null;
  caption: string | null;
  status: ArtJobStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
