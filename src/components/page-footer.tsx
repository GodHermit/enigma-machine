import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export type PageFooterProps = ComponentProps<'footer'>

/** Centred credit line at the bottom of the page, like the reference site. */
export function PageFooter({ className, ...props }: PageFooterProps) {
  return (
    <footer className={cn('mt-12 py-4 text-center', className)} {...props}>
      <p className="m-0">
        Made with{' '}
        <span role="img" aria-label="love">
          🖤
        </span>{' '}
        by{' '}
        <a
          href="https://olehproidakov.pp.ua"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm outline-none focus-visible:decoration-2"
        >
          Oleh Proidakov
        </a>
        .
      </p>
    </footer>
  )
}
