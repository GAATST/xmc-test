import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getYouTubeThumbnail(videoId: string, width: number, height?: number): string {
  if (!videoId || typeof videoId !== 'string') {
    throw new Error('Invalid YouTube video ID');
  }

  // YouTube thumbnail sizes from largest to smallest
  const thumbnailSizes = [
    { type: 'maxresdefault', width: 1280, height: 720 },
    { type: 'sddefault', width: 640, height: 480 },
    { type: 'hqdefault', width: 480, height: 360 },
    { type: 'mqdefault', width: 320, height: 180 },
    { type: 'default', width: 120, height: 90 },
  ];

  // Find the smallest thumbnail that is larger than the requested size
  // or the largest available if requested size is larger than all options
  let selectedSize = thumbnailSizes[0].type;

  for (const size of thumbnailSizes) {
    if (width <= size.width && (!height || height <= size.height)) {
      selectedSize = size.type;
    } else {
      break;
    }
  }

  return `https://img.youtube.com/vi/${videoId}/${selectedSize}.jpg`;
}
