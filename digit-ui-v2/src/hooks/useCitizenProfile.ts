/**
 * Fetches and updates the currently-signed-in citizen's profile.
 *
 * The egov-user `/user/profile/_update` endpoint has three traps that are
 * easy to fall into (each documented in the design doc next to this file):
 *   - `id` (Long) is required in BOTH RequestInfo.userInfo AND the user
 *     body; missing it → NPE in isLoggedInUserDifferentFromUpdatedUser.
 *   - `active: true` MUST be echoed back or the user is deactivated and
 *     can't log in again — the update is a full overwrite of mutable fields.
 *   - mobileNumber/userName changes are silently dropped (HTTP 200 returns
 *     the original). We never offer mobile change from the profile page.
 *
 * The mutation accepts a partial patch and merges it with the last fetched
 * snapshot so callers don't have to remember which fields to echo.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, getApiBaseUrl } from '@/api';
import { uploadFile, fetchFileUrl } from '@/api/filestore';

const STATE_TENANT = (import.meta.env.VITE_CITIZEN_STATE_TENANT as string) || 'ke';

export type Gender = 'MALE' | 'FEMALE' | 'OTHER';

export const GENDERS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];

export interface CitizenProfile {
  id: number;
  uuid: string;
  userName: string;
  name: string;
  mobileNumber: string;
  emailId: string | null;
  gender: Gender | null;
  dob: string | null;
  photo: string | null;
  type: string;
  active: boolean;
  tenantId: string;
  roles: Array<{ code: string; name: string; tenantId: string }>;
}

export type ProfilePatch = Partial<
  Pick<CitizenProfile, 'name' | 'emailId' | 'gender' | 'dob' | 'photo'>
>;

interface UserSearchResponse {
  user?: CitizenProfile[];
}

async function fetchProfile(uuid: string): Promise<CitizenProfile> {
  const { token } = apiClient.getAuth();
  const res = await fetch(`${getApiBaseUrl()}/user/_search?tenantId=${STATE_TENANT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'citizen-ui', authToken: token ?? '' },
      uuid: [uuid],
      tenantId: STATE_TENANT,
    }),
  });
  if (!res.ok) throw new Error(`Profile fetch failed: HTTP ${res.status}`);
  const json = (await res.json()) as UserSearchResponse;
  const user = json.user?.[0];
  if (!user) throw new Error('Citizen profile not found.');
  return user;
}

/**
 * dob comes back as `YYYY-MM-DD` from /user/_search, but the update endpoint
 * accepts `DD/MM/YYYY`. The HTML <input type="date"> uses ISO `YYYY-MM-DD`.
 * Convert at the boundary so the form can stay ISO end-to-end.
 */
function toApiDob(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

async function updateProfile(current: CitizenProfile, patch: ProfilePatch): Promise<CitizenProfile> {
  const { token } = apiClient.getAuth();
  const merged: CitizenProfile = { ...current, ...patch };
  const payload = {
    RequestInfo: {
      apiId: 'citizen-ui',
      authToken: token ?? '',
      userInfo: {
        id: current.id,
        uuid: current.uuid,
        userName: current.userName,
        tenantId: current.tenantId,
        type: current.type,
      },
    },
    user: {
      id: current.id,
      uuid: current.uuid,
      tenantId: current.tenantId,
      userName: current.userName,
      mobileNumber: current.mobileNumber,
      name: merged.name,
      emailId: merged.emailId,
      gender: merged.gender,
      dob: toApiDob(merged.dob),
      photo: merged.photo,
      type: current.type,
      active: true,
      roles: current.roles,
    },
  };
  const res = await fetch(`${getApiBaseUrl()}/user/profile/_update?tenantId=${STATE_TENANT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { Errors?: Array<{ message?: string }> }).Errors?.[0]?.message ??
        `Profile update failed: HTTP ${res.status}`,
    );
  }
  const json = (await res.json()) as { user?: CitizenProfile[] };
  const updated = json.user?.[0];
  if (!updated) throw new Error('Profile update returned no user.');
  return updated;
}

export function useCitizenProfile() {
  const qc = useQueryClient();
  const { user } = apiClient.getAuth();
  const uuid = user?.uuid ?? '';

  const query = useQuery({
    queryKey: ['citizen-profile', uuid],
    queryFn: () => fetchProfile(uuid),
    enabled: !!uuid,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (patch: ProfilePatch) => {
      if (!query.data) throw new Error('Profile not loaded yet.');
      return updateProfile(query.data, patch);
    },
    onSuccess: (updated) => {
      qc.setQueryData(['citizen-profile', uuid], updated);
    },
  });

  return {
    profile: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    save: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}

export const uploadProfilePhoto = (file: File) =>
  uploadFile(file, 'user-profile', { tag: 'profile-photo' });

export const fetchPhotoUrl = (fileStoreId: string) => fetchFileUrl(fileStoreId);
