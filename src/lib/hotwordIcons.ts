import {
  IconAbc,
  IconBuildingStore,
  IconTag,
  IconUser,
  IconVocabulary,
  IconCode,
  IconWorld,
  IconMusic,
  IconBook,
  IconHeart,
  IconStar,
  IconBolt,
} from "@tabler/icons-react";

const ICON_MAP: Record<string, typeof IconTag> = {
  IconUser,
  IconVocabulary,
  IconBuildingStore,
  IconAbc,
  IconTag,
  IconCode,
  IconWorld,
  IconMusic,
  IconBook,
  IconHeart,
  IconStar,
  IconBolt,
};

export const resolveIcon = (name?: string): typeof IconTag =>
  (name && ICON_MAP[name]) || IconTag;

export const AVAILABLE_ICONS = Object.keys(ICON_MAP);
