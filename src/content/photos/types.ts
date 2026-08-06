export type PhotoItem = {
  file: string;
  alt: string;
  caption?: string;
  credit?: string;
};

export type PhotoSection = {
  id: string;
  title: string;
  description?: string;
  order: number;
  photos: PhotoItem[];
};

export type GalleryPhoto = PhotoItem & {
  id: string;
  src: string;
};

export type GalleryPhotoSection = Omit<PhotoSection, "photos"> & {
  photos: GalleryPhoto[];
};
