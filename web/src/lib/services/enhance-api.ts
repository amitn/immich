// TODO: replace with @immich/sdk once the open-api spec is regenerated with the auto-enhance endpoints
import { getBaseUrl } from '@immich/sdk';

export type EnhanceStrength = 'subtle' | 'normal' | 'strong';

export type EnhanceCorrectionType =
  'denoise' | 'whiteBalance' | 'levels' | 'exposure' | 'localContrast' | 'saturation' | 'sharpen';

export type EnhanceCorrectionDto = {
  type: EnhanceCorrectionType;
  amount: number;
  description: string;
  reason: string;
};

export type EnhanceAnalysisResponseDto = {
  assetId: string;
  strength: EnhanceStrength;
  needed: boolean;
  adjustments: string[];
  corrections: EnhanceCorrectionDto[];
  notes: string[];
  plan: Record<string, unknown>;
};

export type EnhanceResponseDto = {
  id: string;
  sourceId: string;
  adjustments: string[];
  duplicate: boolean;
};

export type EnhanceOptions = { strength?: EnhanceStrength; only?: EnhanceCorrectionType[] };

export class EnhanceApiError extends Error {
  override name = 'EnhanceApiError';

  constructor(
    message: string,
    readonly status: number,
    /** the `message` of the server's error response, if any */
    readonly serverMessage?: string,
  ) {
    super(message);
  }
}

const url = (id: string, path: string, query: Record<string, string | undefined> = {}) => {
  const params = new URLSearchParams(
    Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const search = params.toString();
  return `${getBaseUrl()}/assets/${encodeURIComponent(id)}/${path}${search ? `?${search}` : ''}`;
};

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const serverMessage =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : undefined;
    throw new EnhanceApiError(serverMessage ?? `HTTP ${response.status}`, response.status, serverMessage);
  }

  return data as T;
};

/** Which corrections auto-enhance would apply to a photo, without changing anything */
export const analyzeEnhancement = (id: string, options: EnhanceOptions = {}) =>
  post<EnhanceAnalysisResponseDto>(url(id, 'enhance/preview'), options);

/** URL of a JPEG with the photo before and after auto-enhance, side by side */
export const getEnhancePreviewUrl = (id: string, strength?: EnhanceStrength) =>
  url(id, 'enhance/preview.jpg', { strength });

/** Save an auto-enhanced copy of a photo, stacked with the original */
export const enhanceAsset = (id: string, options: EnhanceOptions = {}) =>
  post<EnhanceResponseDto>(url(id, 'enhance'), options);
