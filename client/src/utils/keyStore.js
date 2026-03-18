const DB_NAME = 'chatforia';
const STORE = 'keys';
const VERSION = 2;

function openDB(timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const timer = setTimeout(() => {
      finishReject(new Error('IndexedDB open timeout'));
    }, timeoutMs);

    let req;
    try {
      req = indexedDB.open(DB_NAME, VERSION);
    } catch (err) {
      clearTimeout(timer);
      finishReject(err);
      return;
    }

    req.onupgradeneeded = (e) => {
      try {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      } catch (err) {
        clearTimeout(timer);
        finishReject(err);
      }
    };

    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;

      // If another tab/version change happens later, close this connection
      // so future opens/upgrades do not get stuck.
      db.onversionchange = () => {
        try {
          db.close();
        } catch {}
      };

      finishResolve(db);
    };

    req.onerror = () => {
      clearTimeout(timer);
      finishReject(req.error || new Error('IndexedDB open failed'));
    };

    req.onblocked = () => {
      clearTimeout(timer);
      finishReject(
        new Error('IndexedDB upgrade blocked. Close other Chatforia tabs and try again.')
      );
    };
  });
}

async function put(key, value) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`IDB put failed for ${key}`));
      tx.onabort = () => reject(tx.error || new Error(`IDB put aborted for ${key}`));
    });
  } finally {
    try {
      db.close();
    } catch {}
  }
}

async function get(key) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);

      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error || new Error(`IDB get failed for ${key}`));
      tx.onabort = () => reject(tx.error || new Error(`IDB get aborted for ${key}`));
    });
  } finally {
    try {
      db.close();
    } catch {}
  }
}

async function del(key) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`IDB delete failed for ${key}`));
      tx.onabort = () => reject(tx.error || new Error(`IDB delete aborted for ${key}`));
    });
  } finally {
    try {
      db.close();
    } catch {}
  }
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

// One-time migration from localStorage → IndexedDB
export async function migrateLocalToIDBIfNeeded() {
  const lsPub = localStorage.getItem('co_pub');
  const lsPriv = localStorage.getItem('co_priv');
  if (!lsPub && !lsPriv) return false;

  await saveKeysIDB({
    publicKey: lsPub || undefined,
    privateKey: lsPriv || undefined,
  });

  localStorage.removeItem('co_pub');
  localStorage.removeItem('co_priv');
  return true;
}