import React from 'react';

interface VotypeHandProps {
  className?: string;
  size?: number;
}

export const VotypeHand: React.FC<VotypeHandProps> = ({
  className = "",
  size = 48
}) => {
  const scale = size / 48;
  return (
    <div className={className} style={{ transform: `scale(${scale})` }} >
      <style>{`
        /* Common layout for both layers */
        .logo-layer {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* Layer 1: The Base Content - Uses currentColor */
        .layer-base .char {
          color: currentColor;
        }
        .layer-base .orbit-ring {
          border-color: currentColor;
          opacity: 0.3;
        }
        .layer-base .bar {
          background-color: currentColor;
        }
        .layer-base .satellite-dot {
          background-color: currentColor;
          box-shadow: 0 0 10px currentColor;
        }

        /* Layer 2: The Shine Content - Pure white with mask */
        .layer-shine {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 10;
          color: white;

          /* The Mask: A gradient that moves across to reveal the white layer */
          -webkit-mask-image: linear-gradient(
            110deg,
            transparent 35%,
            #000 48%,
            #000 52%,
            transparent 65%
          );
          mask-image: linear-gradient(
            110deg,
            transparent 35%,
            #000 48%,
            #000 52%,
            transparent 65%
          );
          -webkit-mask-size: 150% 100%;
          mask-size: 150% 100%;
          -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;

          /* Shine Animation: 3s cycle with 1.2s delay */
          opacity: 0;
          animation: shine-scan 5s ease-out infinite;
          animation-delay: 1.2s;
        }

        /* Overrides for the Shine Layer elements */
        .layer-shine .orbit-ring {
          border-color: white;
          opacity: 0.9;
        }
        .layer-shine .bar {
          background-color: white;
        }
        .layer-shine .satellite-dot {
          background-color: white;
          box-shadow: 0 0 15px white;
        }

        /* --- Animation Primitives --- */

        /* Char Reveal */
        .char {
          opacity: 0;
          animation: votype-reveal 0.6s ease-out forwards;
          position: relative;
          font-style: italic;
          font-size: 3rem;
          font-weight: 900;
          letter-spacing: 0.1em;
        }

        /* Icon Layout */
        .icon-o {
          position: relative;
          width: 3rem;
          height: 3rem;
          margin: 0 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          animation: votype-reveal 0.6s ease-out forwards;
        }

        /* 1. Satellite Orbit Ring */
        .orbit-ring {
          position: absolute;
          inset: 0;
          border: 3px solid;
          border-radius: 50%;
          box-sizing: border-box;
        }

        /* 2. Rotating Satellite Dot Wrapper */
        .satellite-wrapper {
          position: absolute;
          inset: 0;
          animation: votype-spin 3s linear infinite;
        }

        .satellite-dot {
          position: absolute;
          top: 0;
          left: 50%;
          transform: translate(-50%, 0);
          margin-top: -0.375rem;
          width: 0.75rem;
          height: 0.75rem;
          border-radius: 50%;
        }

        /* 3. Inner Voice Bars */
        .voice-bars {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.25rem;
          height: 1.5rem;
        }

        .bar {
          width: 0.375rem;
          height: 100%;
          border-radius: 9999px;
          transform-origin: center;
          animation: votype-bar 0.8s ease-in-out infinite;
        }

        .bar:nth-child(2) {
          animation-duration: 1.1s;
          animation-delay: 0.1s;
        }
        .bar:nth-child(3) {
          animation-duration: 0.9s;
          animation-delay: 0.2s;
        }

        /* --- Keyframes --- */

        @keyframes votype-reveal {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes votype-spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes votype-bar {
          0%, 100% {
            transform: scaleY(0.4);
            opacity: 0.5;
          }
          50% {
            transform: scaleY(1);
            opacity: 1;
          }
        }

        /* The Light Scan Animation: Left to Right */
        @keyframes shine-scan {
          0% {
            -webkit-mask-position: 150% 0;
            mask-position: 150% 0;
            opacity: 1;
          }
          35% {
            -webkit-mask-position: -150% 0;
            mask-position: -150% 0;
            opacity: 1;
          }
          35.1% {
            opacity: 0;
          }
          100% {
            -webkit-mask-position: -150% 0;
            mask-position: -150% 0;
            opacity: 0;
          }
        }
      `}</style>
      <div>
        <div className="container">
          <div className="logo-wrapper" style={{ position: 'relative' }}>
            <div className="logo-layer layer-base">
              <span className="char" style={{ animationDelay: '0ms' }}>V</span>

              <div className="icon-o" style={{ animationDelay: '100ms' }}>
                <div className="orbit-ring"></div>
                <div className="satellite-wrapper">
                  <div className="satellite-dot"></div>
                </div>
                <div className="voice-bars">
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                </div>
              </div>

              <span className="char" style={{ animationDelay: '200ms' }}>T</span>
              <span className="char" style={{ animationDelay: '300ms' }}>Y</span>
              <span className="char" style={{ animationDelay: '400ms' }}>P</span>
              <span className="char" style={{ animationDelay: '500ms' }}>E</span>
            </div>

            <div className="logo-layer layer-shine" aria-hidden="true">
              <span className="char" style={{ animationDelay: '0ms' }}>V</span>

              <div className="icon-o" style={{ animationDelay: '100ms' }}>
                <div className="orbit-ring"></div>
                <div className="satellite-wrapper">
                  <div className="satellite-dot"></div>
                </div>
                <div className="voice-bars">
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                </div>
              </div>

              <span className="char" style={{ animationDelay: '200ms' }}>T</span>
              <span className="char" style={{ animationDelay: '300ms' }}>Y</span>
              <span className="char" style={{ animationDelay: '400ms' }}>P</span>
              <span className="char" style={{ animationDelay: '500ms' }}>E</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default VotypeHand;
