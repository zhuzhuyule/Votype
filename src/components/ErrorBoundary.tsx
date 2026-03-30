import React from "react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          style={{
            padding: 20,
            color: "red",
            background: "rgba(255,255,255,0.9)",
            borderRadius: 8,
            maxWidth: 400,
            margin: "20px auto",
          }}
        >
          <h3>Something went wrong.</h3>
          <pre style={{ fontSize: 11, overflow: "auto" }}>
            {this.state.error?.toString()}
          </pre>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 12,
              padding: "6px 16px",
              cursor: "pointer",
              borderRadius: 4,
              border: "1px solid #ccc",
              background: "#f5f5f5",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
