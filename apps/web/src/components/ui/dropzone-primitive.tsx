'use client'

import { composeEventHandlers } from '@radix-ui/primitive'
import { Primitive } from '@radix-ui/react-primitive'
import * as React from 'react'
import {
  type DropzoneOptions,
  type DropzoneState,
  type FileRejection,
  type FileWithPath,
  useDropzone,
} from 'react-dropzone'

export type DropzoneContextProps = DropzoneState & DropzoneOptions

const DropzoneContext = React.createContext<DropzoneContextProps>(
  {} as DropzoneContextProps
)

export const useDropzoneContext = () => React.useContext(DropzoneContext)

export interface DropzoneProps extends DropzoneOptions {
  children: React.ReactNode | ((state: DropzoneContextProps) => React.ReactNode)
}

export const Dropzone = ({ children, ...props }: DropzoneProps) => {
  const state = useDropzone(props)

  const context = { ...state, ...props }

  return (
    <DropzoneContext.Provider value={context}>
      {typeof children === 'function' ? children(context) : children}
    </DropzoneContext.Provider>
  )
}
Dropzone.displayName = 'Dropzone'

export const DropzoneInput = React.forwardRef<
  React.ElementRef<typeof Primitive.input>,
  React.ComponentPropsWithoutRef<typeof Primitive.input>
>((props, ref) => {
  const { getInputProps, disabled } = useDropzoneContext()

  return (
    <Primitive.input ref={ref} {...getInputProps({ disabled, ...props })} />
  )
})
DropzoneInput.displayName = 'DropzoneInput'

export const DropzoneZone = React.forwardRef<
  React.ElementRef<typeof Primitive.div>,
  React.ComponentPropsWithoutRef<typeof Primitive.div>
>((props, ref) => {
  const {
    getRootProps,
    isFocused,
    isDragActive,
    isDragAccept,
    isDragReject,
    isFileDialogActive,
    preventDropOnDocument,
    noClick,
    noKeyboard,
    noDrag,
    noDragEventsBubbling,
    disabled,
  } = useDropzoneContext()

  return (
    <Primitive.div
      ref={ref}
      data-prevent-drop-on-document={preventDropOnDocument ? true : undefined}
      data-no-click={noClick ? true : undefined}
      data-no-keyboard={noKeyboard ? true : undefined}
      data-no-drag={noDrag ? true : undefined}
      data-no-drag-events-bubbling={noDragEventsBubbling ? true : undefined}
      data-disabled={disabled ? true : undefined}
      data-focused={isFocused ? true : undefined}
      data-drag-active={isDragActive ? true : undefined}
      data-drag-accept={isDragAccept ? true : undefined}
      data-drag-reject={isDragReject ? true : undefined}
      data-file-dialog-active={isFileDialogActive ? true : undefined}
      {...getRootProps(props)}
    />
  )
})
DropzoneZone.displayName = 'DropzoneZone'

export const DropzoneTrigger = React.forwardRef<
  React.ElementRef<typeof Primitive.button>,
  React.ComponentPropsWithoutRef<typeof Primitive.button>
>(({ onClick, ...props }, ref) => {
  const { open } = useDropzoneContext()

  return (
    <Primitive.button
      ref={ref}
      onClick={composeEventHandlers(onClick, open)}
      {...props}
    />
  )
})
DropzoneTrigger.displayName = 'DropzoneTrigger'

export interface DropzoneDragAcceptedProps {
  children?: React.ReactNode
}

export const DropzoneDragAccepted = ({
  children,
}: DropzoneDragAcceptedProps) => {
  const { isDragAccept } = useDropzoneContext()

  if (!isDragAccept) {
    return null
  }

  return children
}

export interface DropzoneDragRejectedProps {
  children?: React.ReactNode
}

export const DropzoneDragRejected = ({
  children,
}: DropzoneDragRejectedProps) => {
  const { isDragReject } = useDropzoneContext()

  if (!isDragReject) {
    return null
  }

  return children
}

export interface DropzoneDragDefaultProps {
  children?: React.ReactNode
}

export const DropzoneDragDefault = ({ children }: DropzoneDragDefaultProps) => {
  const { isDragActive } = useDropzoneContext()

  if (isDragActive) {
    return null
  }

  return children
}

export interface DropzoneAcceptedProps {
  children: (acceptedFiles: Readonly<FileWithPath[]>) => React.ReactNode
}

export const DropzoneAccepted = ({ children }: DropzoneAcceptedProps) => {
  const { acceptedFiles } = useDropzoneContext()

  return children(acceptedFiles)
}

export interface DropzoneRejectedProps {
  children: (fileRejections: Readonly<FileRejection[]>) => React.ReactNode
}

export const DropzoneRejected = ({ children }: DropzoneRejectedProps) => {
  const { fileRejections } = useDropzoneContext()

  return children(fileRejections)
}

const Root = Dropzone
const Input = DropzoneInput
const Zone = DropzoneZone
const Trigger = DropzoneTrigger
const DragAccepted = DropzoneDragAccepted
const DragRejected = DropzoneDragRejected
const DragDefault = DropzoneDragDefault
const Accepted = DropzoneAccepted
const Rejected = DropzoneRejected

export {
  Root,
  Input,
  Zone,
  Trigger,
  DragAccepted,
  DragRejected,
  DragDefault,
  Accepted,
  Rejected,
}
