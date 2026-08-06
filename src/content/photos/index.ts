import type { GalleryPhotoSection, PhotoSection } from "./types";

const metadataModules = import.meta.glob<PhotoSection>("./*/metadata.ts", {
  eager: true,
  import: "default",
});

const imageModules = import.meta.glob<string>(
  "./*/*.{avif,webp,png,jpg,jpeg}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

function sectionFolder(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 2];
}

export const photoSections: GalleryPhotoSection[] = Object.entries(
  metadataModules,
)
  .map(([metadataPath, section]) => {
    const folder = sectionFolder(metadataPath);

    return {
      ...section,
      photos: section.photos.map((photo) => {
        const assetPath = `./${folder}/${photo.file}`;
        const src = imageModules[assetPath];

        if (!src) {
          throw new Error(`Missing gallery photo asset: ${assetPath}`);
        }

        return {
          ...photo,
          id: `${section.id}:${photo.file}`,
          src,
        };
      }),
    };
  })
  .sort((a, b) => a.order - b.order);
