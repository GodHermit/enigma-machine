import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from './page-header'
import { PageFooter } from './page-footer'

describe('PageHeader', () => {
  it('renders the display title and the Wikipedia lead link', () => {
    render(<PageHeader />)
    const title = screen.getByRole('heading', { level: 1, name: 'Enigma Machine' })
    expect(title.className).toContain('font-light')
    expect(title.className).toContain('text-[calc(1.625rem+4.5vw)]')
    const link = screen.getByRole('link', { name: 'Wikipedia' })
    expect(link).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Enigma_machine')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link.parentElement).toHaveTextContent('Read more on Wikipedia.')
    expect(screen.getByText(/F\*ck Nazis, btw\./)).toHaveClass('text-muted')
  })

  it('merges className onto the header', () => {
    render(<PageHeader className="pb-6" />)
    expect(screen.getByRole('banner')).toHaveClass('text-center', 'pb-6')
  })
})

describe('PageFooter', () => {
  it('renders the credit line', () => {
    render(<PageFooter />)
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveTextContent('Made with 🖤 by Oleh Proidakov.')
    expect(screen.getByRole('img', { name: 'love' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Oleh Proidakov' })).toHaveAttribute(
      'href',
      'https://olehproidakov.pp.ua',
    )
  })
})
