// TODO: replace with @immich/sdk once the open-api spec is regenerated
//
// Adapter for the /api/art endpoints (artistic styles run by the art agent profile).
import { adapterRequest } from '$lib/services/api-adapter';
import type { ArtJobCreateDto, ArtJobResponseDto, ArtStyleDto } from '$lib/types/assistant';

export const getArtStyles = () => adapterRequest<ArtStyleDto[]>('/art/styles');

export const createArtJob = ({ artJobCreateDto }: { artJobCreateDto: ArtJobCreateDto }) =>
  adapterRequest<ArtJobResponseDto>('/art/jobs', { method: 'POST', body: artJobCreateDto });

export const getArtJob = ({ id }: { id: string }) => adapterRequest<ArtJobResponseDto>(`/art/jobs/${id}`);
