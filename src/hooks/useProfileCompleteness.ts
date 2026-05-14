import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ProfileFieldKey =
  | 'bio'
  | 'location'
  | 'pronouns'
  | 'property_relation'
  | 'fun_fact'
  | 'languages';

/**
 * Extended profile fields — required for HOSTS only.
 * Guests just need a verified email + verified phone, which is
 * collected during sign-up and verified on /profile.
 */
export const HOST_REQUIRED_PROFILE_FIELDS: { key: ProfileFieldKey; label: string }[] = [
  { key: 'bio', label: 'Bio (min. 20 characters)' },
  { key: 'location', label: 'Hometown' },
  { key: 'pronouns', label: 'Pronouns' },
  { key: 'property_relation', label: 'Relation to property' },
  { key: 'fun_fact', label: 'Fun fact' },
  { key: 'languages', label: 'Languages I speak' },
];

/** Back-compat alias (some legacy imports). */
export const REQUIRED_PROFILE_FIELDS = HOST_REQUIRED_PROFILE_FIELDS;

type ProfileRow = Record<ProfileFieldKey, string | null | undefined>;

const computeHostMissing = (row: Partial<ProfileRow>): string[] => {
  const missing: string[] = [];
  for (const field of HOST_REQUIRED_PROFILE_FIELDS) {
    const value = (row[field.key] ?? '').toString().trim();
    if (field.key === 'bio') {
      if (!value || value.length < 20) missing.push(field.label);
    } else if (!value) {
      missing.push(field.label);
    }
  }
  return missing;
};

/**
 * Returns the user's profile-completeness state.
 *
 * Rules:
 * - GUEST: only needs a verified email (always true after sign-up) and a
 *   verified phone number on file. No bio / pronouns / etc. required to book.
 * - HOST:  needs the full extended profile (bio, hometown, pronouns,
 *   relation to property, fun fact, languages spoken).
 */
export function useProfileCompleteness() {
  const { user, profile, isHost } = useAuth();
  const [extra, setExtra] = useState<Partial<ProfileRow> | null>(null);
  const [phoneVerified, setPhoneVerified] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [{ data }, { data: phoneRow }] = await Promise.all([
        supabase
          .from('profiles')
          .select('bio, location, pronouns, property_relation, fun_fact, languages')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('user_verifications')
          .select('status')
          .eq('user_id', user.id)
          .eq('verification_type', 'phone')
          .maybeSingle(),
      ]);
      if (!cancelled) {
        setExtra((data as Partial<ProfileRow> | null) ?? {});
        setPhoneVerified(phoneRow?.status === 'verified');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const merged: Partial<ProfileRow> = {
    bio: extra?.bio ?? profile?.bio ?? '',
    location: extra?.location ?? profile?.location ?? '',
    pronouns: extra?.pronouns ?? '',
    property_relation: extra?.property_relation ?? '',
    fun_fact: extra?.fun_fact ?? '',
    languages: extra?.languages ?? '',
  };

  // Guest path — minimal requirements.
  const guestMissing: string[] = [];
  if (!phoneVerified) guestMissing.push('Verified mobile number');

  // Host path — minimal + extended fields.
  const hostMissing = isHost
    ? [...guestMissing, ...computeHostMissing(merged)]
    : guestMissing;

  const missingFields = isHost ? hostMissing : guestMissing;
  const totalFields = isHost
    ? HOST_REQUIRED_PROFILE_FIELDS.length + 1 /* phone */
    : 1 /* phone */;
  const completedCount = Math.max(0, totalFields - missingFields.length);
  const isComplete = !loading && missingFields.length === 0;
  const percent = Math.round((completedCount / totalFields) * 100);

  return {
    loading,
    isComplete,
    missingFields,
    completedCount,
    totalFields,
    percent,
    isHost,
    phoneVerified,
  };
}
