import type { ComponentProps } from 'react'
import { cn } from '../lib/cn'

export type PageHeaderProps = ComponentProps<'header'>

/** Page title ("display-1") and the lead paragraph, centred like the reference site. */
export function PageHeader({ className, ...props }: PageHeaderProps) {
  return (
    <header className={cn('text-center', className)} {...props}>
      <h1 className="mt-0 mb-2 text-[calc(1.625rem+4.5vw)] leading-[1.2] font-light min-[1200px]:text-[5rem]">
        Enigma Machine
      </h1>
      <p className="mt-0 mb-4 text-xl font-light">
        Read more on{' '}
        <a
          href="https://en.wikipedia.org/wiki/Enigma_machine"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm outline-none focus-visible:decoration-2"
        >
          Wikipedia
        </a>
        .
      </p>
      <p className="mt-0 mb-4 text-sm text-muted italic">
        F*ck Nazis, btw. Whoever uses this machine for evil shall be haunted every night by a
        mosquito buzzing in their ear that can never be caught. 💀
      </p>
    </header>
  )
}
