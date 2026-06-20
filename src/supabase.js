import { createClient } from '@supabase/supabase-js';

const fallbackUrl = 'https://kawxozbvxroszvkyhszh.supabase.co';
const fallbackAnonKey = 'sb_publishable_pFReZDSG7Yxk80I8CpqGxQ_C8NkyXMD';

const url = (import.meta.env.VITE_SUPABASE_URL || fallbackUrl).trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || fallbackAnonKey).trim();
const enabled = Boolean(url && anonKey);

let client = null;

export function isCloudEnabled() {
  return enabled;
}

export function getSupabase() {
  if (!enabled) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function getCloudUser() {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data?.user || null;
}

/**
 * Connexion cloud silencieuse, sans UI :
 * - réutilise la session existante si présente
 * - sinon tente une session anonyme (si activée côté Supabase Auth)
 */
export async function ensureCloudSessionAuto() {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session?.user) return sessionData.session.user;

  const anon = await supabase.auth.signInAnonymously();
  if (anon.error) {
    console.warn('supabase anonymous auth unavailable:', anon.error.message);
    return null;
  }
  return anon.data?.user || null;
}

export async function consumeAuthRedirect() {
  const supabase = getSupabase();
  if (!supabase) return null;
  // Supabase JS gère déjà le parsing URL, on force juste la résolution session.
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export async function sendMagicLink(email) {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Cloud désactivé');
  const trimmed = String(email || '').trim();
  if (!trimmed) throw new Error('Email requis');
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw error;
}

export async function signOutCloud() {
  const supabase = getSupabase();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function onCloudAuthChange(callback) {
  const supabase = getSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback?.(session?.user || null);
  });
  return () => data.subscription.unsubscribe();
}
