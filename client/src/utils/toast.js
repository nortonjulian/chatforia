import { notifications } from '@mantine/notifications';

const DISABLED = import.meta?.env?.VITE_DISABLE_TOASTS === '1';

const noop = () => {};
const noopLoading = () => ({ dismiss: noop });

let toast; // <-- assign first, export after

if (DISABLED) {
  toast = {
    ok: noop,
    info: noop,
    err: noop,

    success: noop,
    error: noop,
    warn: noop,

    loading: noopLoading,
    dismiss: noop,
  };
} else {
  let lastKey = null;

  function show(color, message, opts = {}) {
    const key = `${color}:${message}`;
    if (key === lastKey) return; // naive dedupe in same microtask
    lastKey = key;
    queueMicrotask(() => { lastKey = null; });
    notifications.show({ color, message, withBorder: true, ...opts });
  }

  toast = {
    ok(msg, opts)   { show('green',  msg, opts); },
    info(msg, opts) { show('blue',   msg, opts); },
    err(msg, opts)  { show('red',    msg, opts); },

    success(msg, opts) { show('green',  msg, opts); },
    error(msg, opts)   { show('red',    msg, opts); },
    warn(msg, opts)    { show('yellow', msg, opts); },

    loading(message = 'Working...', opts = {}) {
      const id = `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      notifications.show({ id, message, loading: true, autoClose: false, withBorder: true, ...opts });
      return { dismiss: () => notifications.hide(id) };
    },
    dismiss(id) { if (id) notifications.hide(id); },
  };

  if (import.meta.env.DEV) {
    const origShow = notifications.show;
    notifications.show = (opts) => {
      // eslint-disable-next-line no-console
      console.groupCollapsed('[toast]', opts?.message);
      console.trace();
      console.groupEnd();
      return origShow(opts);
    };
  }
}

export { toast };
export default toast;
