/** Files only: never follow a dragged URL or copy an existing preview into edits.
 * Capture during the drop event, before DataTransfer becomes protected. */
export function spriteUploadFile(files: ArrayLike<File>): File {
  const file = files[0]
  if (files.length !== 1 || !file) {
    throw new Error(
      'Choose or drop one image file at a time, not a folder or link.'
    )
  }
  const image =
    file.type.startsWith('image/') ||
    (!file.type && /\.(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i.test(file.name))
  if (!image) {
    throw new Error('Choose an image file, such as PNG, JPEG, WebP, or GIF.')
  }
  if (!file.size)
    throw new Error('This image is empty. Choose another image file.')
  return file
}

/** Combined view deliberately edits the background, not both layers. */
export function spriteUploadTarget(
  hasOverlay: boolean,
  layer: string
): 'main' | 'soul' {
  return hasOverlay && layer === 'soul' ? 'soul' : 'main'
}
