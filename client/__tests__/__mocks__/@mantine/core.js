/* eslint-disable react/prop-types */
const React = require('react');

/* ---------- helpers ---------- */
const renderContent = (props, children) =>
  children != null && children !== false && children !== true
    ? children
    : props?.label ?? null;

const passthroughFactory = (defaultTag) =>
  React.forwardRef((props, ref) => {
    const { children, onClick, role, ...rest } = props || {};
    // If something is clickable, render a real <button> so RTL can find it by role
    const Tag = onClick && !role ? 'button' : defaultTag;
    return React.createElement(
      Tag,
      { ref, role, ...rest },
      renderContent(props, children)
    );
  });

const withLabel = (id, label, control) =>
  label
    ? React.createElement('label', { htmlFor: id, style: { display: 'block' } }, label, control)
    : control;

/* ---------- base exports ---------- */
const ex = {};

/* Provider / layout */
ex.MantineProvider = ({ children }) => React.createElement(React.Fragment, null, children);
ex.Group   = passthroughFactory('div');
ex.Stack   = passthroughFactory('div');
ex.Paper   = passthroughFactory('div');
ex.Container = passthroughFactory('div');
ex.Divider = React.forwardRef((props, ref) =>
  React.createElement('div', { role: 'separator', ref, ...props })
);
ex.Card = React.forwardRef((props, ref) => {
  const { children, withBorder, ...rest } = props || {}; // strip withBorder
  // Ensure tests relying on data-testid can find the card
  const testId = rest['data-testid'] || 'card';
  return React.createElement(
    'div',
    { ref, 'data-testid': testId, ...rest },
    renderContent(props, children)
  );
});

/**
 * ScrollArea: special-case to support Mantine's `viewportRef` prop
 * without leaking it as an unknown DOM attribute.
 */
ex.ScrollArea = React.forwardRef((props, ref) => {
  const { children, viewportRef, onClick, role, ...rest } = props || {};
  const Tag = onClick && !role ? 'button' : 'div';
  const mergedRef = viewportRef || ref;

  return React.createElement(
    Tag,
    { ref: mergedRef, role, ...rest },
    renderContent(props, children)
  );
});

/* text */
ex.Text  = passthroughFactory('p');
ex.Title = ({ order = 3, children, ...p }) => React.createElement(`h${order}`, p, children);
ex.Kbd   = passthroughFactory('kbd');

/* media */
ex.Image = ({ src, alt = '', ...p }) => React.createElement('img', { src, alt, ...p });
ex.Video = passthroughFactory('video');
ex.Audio = passthroughFactory('audio');
ex.Avatar = ({ src, alt = 'avatar', ...p }) => React.createElement('img', { src, alt, ...p });

/* feedback */
ex.Alert  = ({ children, ...p }) => React.createElement('div', { role: 'alert', ...p }, children);
ex.Loader = () => React.createElement('div', { 'data-testid': 'loader' });

/* buttons */
ex.Button = ({ children, onClick, type = 'button', disabled, loading, ...p }) =>
  // strip `loading` so it doesn't end up as a DOM attribute
  React.createElement(
    'button',
    { onClick, type, disabled, ...p },
    React.createElement('span', null, children)
  );

ex.ActionIcon = ({ children, onClick, type = 'button', disabled, 'aria-label': ariaLabel, title, ...p }) =>
  React.createElement(
    'button',
    { onClick, type, disabled, 'aria-label': ariaLabel, title, ...p },
    React.createElement('span', null, children)
  );

ex.Badge = ({ onClick, children, ...p }) => {
  // If clickable, expose as a <button> to satisfy role queries
  if (onClick) {
    return React.createElement('button', { onClick, ...p }, renderContent({ ...p, children }, children));
  }
  return React.createElement('span', p, renderContent({ ...p, children }, children));
};

ex.CloseButton = ({ 'aria-label': ariaLabel = 'Close', onClick, ...p }) =>
  React.createElement('button', { 'aria-label': ariaLabel, onClick, type: 'button', ...p });

/* inputs */
ex.Checkbox = ({ label, checked, onChange, ...p }) => {
  const id = p.id || `chk_${Math.random().toString(36).slice(2)}`;
  const el = React.createElement('input', { id, type: 'checkbox', checked, onChange, ...p });
  return withLabel(id, label, el);
};

ex.Switch = ({ label, checked, onChange, ...p }) => {
  const id = p.id || `s_${Math.random().toString(36).slice(2)}`;
  const el = React.createElement('input', { id, type: 'checkbox', role: 'switch', checked, onChange, ...p });
  return withLabel(id, label, el);
};

ex.TextInput = ({ label, placeholder, value, onChange, ...p }) => {
  const id = p.id || `ti_${Math.random().toString(36).slice(2)}`;
  const el = React.createElement('input', { id, type: 'text', placeholder, value, onChange, ...p });
  return withLabel(id, label, el);
};

ex.PasswordInput = ({ label, placeholder, value, onChange, ...p }) => {
  const id = p.id || `pw_${Math.random().toString(36).slice(2)}`;
  const el = React.createElement('input', { id, type: 'password', placeholder, value, onChange, ...p });
  return withLabel(id, label, el);
};

ex.Textarea = ({ label, placeholder, value, onChange, ...p }) => {
  const id = p.id || `ta_${Math.random().toString(36).slice(2)}`;
  const el = React.createElement('textarea', { id, placeholder, value, onChange, ...p });
  return withLabel(id, label, el);
};

/* Native selects */
ex.Select = ({ label, data = [], value, onChange, disabled, ...p }) => {
  const id = p.id || `sel_${Math.random().toString(36).slice(2)}`;
  const opts = data.map((o) =>
    React.createElement('option', { key: o.value, value: o.value }, o.label ?? o.value)
  );
  const handle = (e) => onChange && onChange(e.target.value);
  const el = React.createElement('select', { id, value, onChange: handle, disabled, ...p }, opts);
  return withLabel(id, label, el);
};

ex.MultiSelect = ({ label, data = [], value = [], onChange, disabled, ...p }) => {
  const id = p.id || `ms_${Math.random().toString(36).slice(2)}`;
  const opts = data.map((o) =>
    React.createElement('option', { key: o.value, value: o.value }, o.label ?? o.value)
  );
  const handle = (e) =>
    onChange && onChange(Array.from(e.target.selectedOptions).map((o) => o.value));
  const el = React.createElement('select', { id, multiple: true, value, onChange: handle, disabled, ...p }, opts);
  return withLabel(id, label, el);
};

ex.FileInput = React.forwardRef(({ label, placeholder, accept, onChange, ...p }, ref) => {
  const id = p.id || `file_${Math.random().toString(36).slice(2)}`;
  const el = React.createElement('input', {
    id,
    type: 'file',
    accept,
    onChange,
    'aria-label': placeholder || label || 'file',
    ref,
    ...p,
  });
  return label ? withLabel(id, label, el) : el;
});

/* overlays */
const PassThrough = ({ children }) => React.createElement(React.Fragment, null, children);

/* Tooltip: keep any existing aria-label, but also set from Tooltip label for name queries */
ex.Tooltip = ({ label, children }) => {
  if (React.isValidElement(children) && label) {
    const existing = children.props['aria-label'];
    return React.cloneElement(children, {
      'aria-label': existing || (typeof label === 'string' ? label : undefined),
      title: typeof label === 'string' ? label : undefined,
    });
  }
  return children || null;
};

/* Popover always renders children (no portal/positioning logic) */
ex.Popover = Object.assign(PassThrough, { Target: PassThrough, Dropdown: PassThrough });

/* Modal/Drawer as <section role="dialog"> with accessible name from title */
const makeDialog = () =>
  ({ opened, onClose, title, children, ...p }) =>
    opened
      ? React.createElement(
          'section',
          { role: 'dialog', 'aria-label': typeof title === 'string' ? title : undefined, ...p },
          title ? React.createElement('h2', null, title) : null,
          children
        )
      : null;

ex.Modal  = makeDialog();
ex.Drawer = makeDialog();

/* table */
ex.Table = Object.assign(({ children, ...p }) => React.createElement('table', p, children), {
  Thead: (props) => React.createElement('thead', props),
  Tbody: (props) => React.createElement('tbody', props),
  Tr:    (props) => React.createElement('tr', props),
  Th:    (props) => React.createElement('th', props),
  Td:    (props) => React.createElement('td', props),
});

/* Anchor */
ex.Anchor = ({ component: Comp = 'a', children, ...p }) => React.createElement(Comp, p, children);

/* ---------- proxy fallback for anything else ---------- */
module.exports = new Proxy(ex, {
  get(target, prop) {
    if (prop in target) return target[prop];
    // Generic passthrough; if clickable, become a <button>; also render `label` prop visibly
    const Comp = passthroughFactory('div');
    target[prop] = Comp;
    return Comp;
  },
});
