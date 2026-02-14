
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  componentDidMount() {
      // Catch async errors (promises) that React doesn't catch by default
      window.addEventListener('unhandledrejection', this.handlePromiseRejection);
  }

  componentWillUnmount() {
      window.removeEventListener('unhandledrejection', this.handlePromiseRejection);
  }

  private handlePromiseRejection = (event: PromiseRejectionEvent) => {
      console.error("Unhandled Promise Rejection:", event.reason);
      // Capture the error to display specific UI
      const msg = event.reason?.message || String(event.reason);
      // Only intervene if it looks like a crash or critical failure, 
      // otherwise let the app handle it (e.g. toasts)
      if (msg.includes("Core Fault") || msg.includes("Minified React error") || msg.includes("Element type is invalid")) {
         this.setState({ hasError: true, error: new Error(msg) });
      }
  }

  private handleRetry = () => {
      this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private getErrorConfig = (error: Error | null) => {
    const msg = (error?.message || '').toLowerCase();
    
    // 503 / Overload -> Retry
    if (msg.includes('503') || msg.includes('overloaded')) {
      return {
        title: "Neural Lattice Overloaded",
        desc: "The matrix compute nodes are currently at capacity. This is a temporary anomaly.",
        action: this.handleRetry,
        label: "Re-establish Link (Retry)",
        color: "text-yellow-500",
        borderColor: "border-yellow-900/30",
        bgStyle: "bg-yellow-950/10"
      };
    }
    
    // Network / Offline -> Retry
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('offline') || msg.includes('failed to fetch')) {
       return {
        title: "Neural Link Severed",
        desc: "Connection to the core network lost. Check your local uplink.",
        action: this.handleRetry,
        label: "Reconnect (Retry)",
        color: "text-blue-500",
        borderColor: "border-blue-900/30",
        bgStyle: "bg-blue-950/10"
      };
    }

    // Rate Limit -> Retry
    if (msg.includes('quota') || msg.includes('429')) {
        return {
          title: "Rate Limit Exceeded",
          desc: "You are transmitting too quickly. The core has throttled your connection.",
          action: this.handleRetry,
          label: "Wait & Retry",
          color: "text-orange-500",
          borderColor: "border-orange-900/30",
          bgStyle: "bg-orange-950/10"
        };
    }
    
    // Default / Critical -> Reload
    return {
      title: "Critical System Failure",
      desc: "A fatal paradox has occurred in the simulation logic.",
      action: this.handleReload,
      label: "Hard Reboot System",
      color: "text-red-600",
      borderColor: "border-red-900/30",
      bgStyle: "bg-red-950/10"
    };
  };

  public render() {
    if (this.state.hasError) {
      const config = this.getErrorConfig(this.state.error);

      return (
        <div className="flex flex-col items-center justify-center h-screen w-full bg-[#050505] text-gray-300 p-8 text-center space-y-8 z-[9999] relative overflow-hidden">
            {/* Ambient Background */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(20,20,20,0.5)_0%,transparent_70%)] pointer-events-none"></div>
            
            <h1 className={`text-5xl md:text-6xl font-bold uppercase tracking-tighter italic animate-pulse ${config.color}`}>
                {config.title}
            </h1>
            
            <div className={`border ${config.borderColor} ${config.bgStyle} backdrop-blur-sm p-8 max-w-2xl w-full space-y-4 rounded-sm shadow-2xl relative`}>
                <div className={`absolute top-0 left-0 w-full h-1 ${config.color.replace('text', 'bg')} opacity-50`}></div>
                
                <p className="text-sm font-light tracking-wide text-gray-400">{config.desc}</p>
                
                <div className="py-4 font-mono text-xs text-gray-500 break-words border-t border-gray-900 mt-4">
                    DETAILS: {this.state.error?.message || "Unknown Runtime Exception"}
                </div>
            </div>

            <div className="flex gap-4">
                <button 
                    onClick={config.action}
                    className={`px-10 py-4 bg-gray-900 border ${config.borderColor} ${config.color} font-bold uppercase tracking-[0.2em] text-xs hover:bg-gray-800 transition-all shadow-[0_0_20px_rgba(0,0,0,0.5)]`}
                >
                    {config.label}
                </button>
                
                {/* Always show Hard Reboot as a backup if we are offering a Retry */}
                {config.action === this.handleRetry && (
                    <button 
                        onClick={this.handleReload}
                        className="px-6 py-4 border border-gray-900 text-gray-600 hover:text-white font-bold uppercase tracking-widest text-xs transition-colors"
                    >
                        Force Reboot
                    </button>
                )}
            </div>
            
            <p className="text-[10px] text-gray-600 uppercase tracking-widest absolute bottom-8">
                Visceral Realism Engine // Error Trapping Protocol
            </p>
        </div>
      );
    }

    return this.props.children;
  }
}
