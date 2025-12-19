import { Box, Flex, IconButton, Slider, Text } from "@radix-ui/themes";
import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface AudioPlayerProps {
  src: string;
  className?: string;
  autoPlay?: boolean;
  onError?: () => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  src,
  className = "",
  autoPlay = false,
  onError,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);
  const animationRef = useRef<number>();

  // Use refs to avoid stale closures in animation loop
  const isPlayingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Stable animation loop with no dependencies
  const tick = useCallback(() => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
    }

    if (isPlayingRef.current) {
      animationRef.current = requestAnimationFrame(tick);
    }
  }, []); // Empty dependency array is key!

  // Manage animation loop lifecycle
  useEffect(() => {
    if (isPlaying) {
      // Only start if not already running
      if (!animationRef.current) {
        animationRef.current = requestAnimationFrame(tick);
      }
    } else {
      // Stop animation loop
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = undefined;
      }
    };
  }, [isPlaying, tick]);

  // Audio event handlers
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      setCurrentTime(0);
      // Auto-play if requested
      if (autoPlay) {
        audio.play().catch(console.error);
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleError = () => {
      setIsPlaying(false);
      onError?.();
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleError);
    };
  }, [onError]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      if (isPlaying) {
        audio.pause();
      } else {
        await audio.play();
      }
    } catch (error) {
      console.error("Playback failed:", error);
    }
  };

  const handleSeek = (values: number[]) => {
    const newTime = values[0];
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const formatTime = (time: number): string => {
    if (!isFinite(time)) return "0:00";

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Fix playhead positioning with better edge case handling
  const getProgressPercent = (): number => {
    if (duration <= 0) return 0;

    // Handle the end case - if we're within 0.1 seconds of the end, show 100%
    if (duration - currentTime < 0.1) return 100;

    const percent = (currentTime / duration) * 100;
    return Math.min(100, Math.max(0, percent));
  };

  const progressPercent = getProgressPercent();

  return (
    <Flex align="center" gap="3" className={className}>
      <audio ref={audioRef} src={src} preload="metadata" />

      <IconButton
        size="1"
        variant="ghost"
        onClick={togglePlay}
        className="transition-colors cursor-pointer text-text hover:text-logo-primary"
        aria-label={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <IconPlayerPause width={20} height={20} />
        ) : (
          <IconPlayerPlay width={20} height={20} />
        )}
      </IconButton>

      <Flex align="center" gap="2" flexGrow="1">
        <Text size="1" color="gray" className="tabular-nums">
          {formatTime(currentTime)}
        </Text>

        <Box flexGrow="1" position="relative">
          <Slider
            value={[currentTime]}
            onValueChange={handleSeek}
            min={0}
            max={duration || 0}
            step={0.01}
            className="w-full"
          />
        </Box>

        <Text size="1" color="gray" className="tabular-nums">
          {formatTime(duration)}
        </Text>
      </Flex>
    </Flex>
  );
};
