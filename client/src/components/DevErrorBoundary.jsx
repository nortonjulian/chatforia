import React from 'react';

export default class DevErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    console.error('[ErrorBoundary] crash:', err, info);
    this.setState({ info });
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16, fontFamily: 'system-ui' }}>
          <h2 style={{ margin: 0, marginBottom: 8 }}>UI crashed</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {String(this.state.err?.stack || this.state.err)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
