const DB_NAME = 'chatforia';
const STORE = 'keys';
const VERSION = 2;

let dbPromise = null;

function openDB(timeoutMs = 150) {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      dbPromise = null;
      reject(err);
    };

    let req;
    try {
      req = indexedDB.open(DB_NAME, VERSION);
    } catch (err) {
      finishReject(err);
      return;
    }

    timer = setTimeout(() => {
      finishReject(new Error('IndexedDB open timeout'));
      try {
        req?.result?.close?.();
      } catch {}
    }, timeoutMs);

    req.onupgradeneeded = (e) => {
      try {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      } catch (err) {
        finishReject(err);
      }
    };

    req.onsuccess = () => {
      const db = req.result;

      db.onversionchange = () => {
        try {
          db.close();
        } catch {}
        dbPromise = null;
      };

      db.onclose = () => {
        dbPromise = null;
      };

      finishResolve(db);
    };

    req.onerror = () => {
      finishReject(req.error || new Error('IndexedDB open failed'));
    };

    req.onblocked = () => {
      finishReject(
        new Error('IndexedDB upgrade blocked. Close other Chatforia tabs and try again.')
      );
    };
  });

  return dbPromise;
}

async function withStore(mode, fn) {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(STORE, mode);
    } catch (err) {
      reject(err);
      return;
    }

    const store = tx.objectStore(STORE);

    let result;
    try {
      result = fn(store, tx);
    } catch (err) {
      reject(err);
      return;
    }

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error(`IDB ${mode} transaction failed`));
    tx.onabort = () => reject(tx.error || new Error(`IDB ${mode} transaction aborted`));
  });
}

async function put(key, value) {
  return withStore('readwrite', (store) => {
    store.put(value, key);
  });
}

async function get(key) {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error || new Error(`IDB get failed for ${key}`));
      tx.onabort = () => reject(tx.error || new Error(`IDB get aborted for ${key}`));
    } catch (err) {
      reject(err);
    }
  });
}

async function del(key) {
  return withStore('readwrite', (store) => {
    store.delete(key);
  });
}

// Public API
export async function saveKeysIDB({ publicKey, privateKey }) {
  if (publicKey) await put('co_pub', publicKey);
  if (privateKey) await put('co_priv', privateKey);
}

export async function loadKeysIDB() {
  const [publicKey, privateKey] = await Promise.all([
    get('co_pub'),
    get('co_priv'),
  ]);
  return { publicKey, privateKey };
}

export async function clearKeysIDB() {
  await Promise.all([del('co_pub'), del('co_priv')]);
}

export async function migrateLocalToIDBIfNeeded() {
  const raw = localStorage.getItem('e2ee_keys_public_only');
  if (!raw) return false;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  const publicKey = parsed?.publicKey || undefined;

  if (!publicKey) return false;

  await saveKeysIDB({
    publicKey,
    privateKey: undefined,
  });

  localStorage.removeItem('e2ee_keys_public_only');
  return true;
}