const BASE = 'https://api.ecoledirecte.com';
const API_VERSION = '4.100.1';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let gtkValue = null;
let gtkCookie = null;
let twoFaToken = null;

function readSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie();
  }
  const raw = res.headers.get('set-cookie');
  return raw ? [raw] : [];
}

async function fetchGtk() {
  const res = await fetch(`${BASE}/v3/login.awp?gtk=1&v=${API_VERSION}`, {
    method: 'GET',
    headers: {
      'User-Agent': USER_AGENT,
      Origin: 'https://www.ecoledirecte.com',
      Referer: 'https://www.ecoledirecte.com/',
    },
  });

  const cookiePairs = [];
  let gtk = null;
  for (const cookie of readSetCookies(res)) {
    const pair = cookie.split(';')[0];
    cookiePairs.push(pair);
    const match = pair.match(/^GTK=(.+)$/);
    if (match) gtk = match[1];
  }

  if (!gtk) throw new Error('GTK introuvable (cookie manquant)');
  gtkValue = gtk;
  gtkCookie = cookiePairs.join('; ');
  return { value: gtk, cookieHeader: gtkCookie };
}

async function edPost(pathname, payload, { token, useGtk, faToken } = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Content-Type': 'text/plain',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: 'https://www.ecoledirecte.com',
    Referer: 'https://www.ecoledirecte.com/',
  };
  if (token) headers['X-Token'] = token;
  if (faToken) headers['2fa-token'] = faToken;
  if (gtkValue) {
    headers['Cookie'] = gtkCookie;
    if (useGtk) headers['X-Gtk'] = gtkValue;
  }

  const res = await fetch(`${BASE}${pathname}`, {
    method: 'POST',
    headers,
    body: 'data=' + JSON.stringify(payload),
  });

  for (const cookie of readSetCookies(res)) {
    const pair = cookie.split(';')[0];
    const match = pair.match(/^GTK=(.+)$/);
    if (match && pair !== 'GTK=') {
      gtkValue = match[1];
      gtkCookie = pair;
    }
  }

  const faHeader = res.headers.get('2fa-token') || res.headers.get('2FA-Token');
  if (faHeader) twoFaToken = faHeader;

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Réponse invalide d'EcoleDirecte (HTTP ${res.status})`);
  }
}

async function login(username, password, fa) {
  await fetchGtk();

  const payload = {
    identifiant: (username || '').trim(),
    motdepasse: password,
    isReLogin: false,
    uuid: '',
    fa: fa && fa.length ? fa : [],
  };

  const json = await edPost(`/v3/login.awp?v=${API_VERSION}`, payload, {
    useGtk: true,
  });
  return normalizeLogin(json);
}

function normalizeLogin(json) {
  if (!json) return { ok: false, error: 'Réponse vide' };

  if (json.code === 200) {
    const account = json.data?.accounts?.[0];
    return {
      ok: true,
      token: json.token,
      account: account
        ? {
            id: account.id,
            prenom: account.prenom,
            nom: account.nom,
            profile: account.profile,
            anneeScolaireCourante: account.anneeScolaireCourante,
          }
        : null,
    };
  }

  if (json.code === 250) {
    return {
      ok: false,
      needQcm: true,
      token: twoFaToken || json.token,
      message: 'Vérification de sécurité requise',
    };
  }

  if (json.code === 505) {
    return { ok: false, error: 'Identifiant ou mot de passe incorrect', code: 505 };
  }

  return {
    ok: false,
    error: json.message || `Erreur EcoleDirecte (code ${json.code})`,
    code: json.code,
  };
}

async function getQcm(token) {
  const json = await edPost(
    `/v3/connexion/doubleauth.awp?verbe=get&v=${API_VERSION}`,
    {},
    { token, faToken: token }
  );
  if (json.code !== 200) {
    return { ok: false, error: json.message || 'QCM indisponible', code: json.code };
  }
  return {
    ok: true,
    token: json.token || token,
    question: decodeB64(json.data.question),
    propositions: (json.data.propositions || []).map((raw) => ({
      raw,
      text: decodeB64(raw),
    })),
  };
}

async function answerQcm(token, rawChoice) {
  const json = await edPost(
    `/v3/connexion/doubleauth.awp?verbe=post&v=${API_VERSION}`,
    { choix: rawChoice },
    { token, faToken: token }
  );
  if (json.code !== 200) {
    return { ok: false, error: json.message || 'Mauvaise réponse au QCM', code: json.code };
  }
  return {
    ok: true,
    fa: { cn: json.data.cn, cv: json.data.cv },
    token: json.token || token,
  };
}

async function getNotes(token, eleveId) {
  const json = await edPost(
    `/v3/eleves/${eleveId}/notes.awp?verbe=get&v=${API_VERSION}`,
    { anneeScolaire: '' },
    { token }
  );
  if (json.code !== 200) {
    return {
      ok: false,
      error: json.message || `Notes indisponibles (code ${json.code})`,
      code: json.code,
    };
  }
  return { ok: true, token: json.token || token, data: json.data };
}

function decodeB64(s) {
  return s ? Buffer.from(s, 'base64').toString('utf8') : '';
}

module.exports = { login, getQcm, answerQcm, getNotes };
