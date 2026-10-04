import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Badge,
  Button,
  Cell,
  CellRow,
  Field,
  Hint,
  InfoTip,
  Input,
  InputGroup,
  InputGroupText,
  SimpleSelect,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from './index'

describe('Button', () => {
  it('renders the primary (black) variant', () => {
    render(<Button variant="primary">Reset</Button>)
    const btn = screen.getByRole('button', { name: 'Reset' })
    expect(btn).toHaveAttribute('type', 'button')
    expect(btn).toHaveAttribute('data-variant', 'primary')
    expect(btn.className).toContain('bg-primary')
    expect(btn.className).toContain('text-primary-fg')
  })

  it('defaults to the outline variant and merges className', () => {
    render(<Button className="w-full">Randomize</Button>)
    const btn = screen.getByRole('button', { name: 'Randomize' })
    expect(btn).toHaveAttribute('data-variant', 'outline')
    expect(btn.className).toContain('border-border')
    expect(btn.className).toContain('bg-bg')
    expect(btn.className).toContain('w-full')
  })

  it('supports ghost/secondary variants, sizes and disabled state', async () => {
    const onClick = vi.fn()
    render(
      <>
        <Button variant="ghost" size="icon" aria-label="More">
          ⋮
        </Button>
        <Button variant="secondary" disabled onClick={onClick}>
          Off
        </Button>
      </>,
    )
    expect(screen.getByRole('button', { name: 'More' }).className).toContain('size-10')
    const off = screen.getByRole('button', { name: 'Off' })
    expect(off).toBeDisabled()
    expect(off.className).toContain('bg-surface-2')
    await userEvent.click(off)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders its child with asChild', () => {
    render(
      <Button asChild variant="primary">
        <a href="#x">Link</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Link' })
    expect(link.className).toContain('bg-primary')
  })
})

describe('SimpleSelect', () => {
  const options = [
    { value: 'I', label: 'Enigma I', description: 'Army & Air Force' },
    { value: 'M3', label: 'Enigma M3' },
    { value: 'M4', label: 'Enigma M4', disabled: true },
  ]

  it('shows the label of the selected value in the trigger', () => {
    render(<SimpleSelect aria-label="Model" value="M3" onValueChange={() => {}} options={options} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    expect(trigger).toHaveTextContent('Enigma M3')
    expect(trigger).not.toHaveTextContent('Army')
  })

  it('shows the placeholder when nothing is selected and supports groups', () => {
    render(
      <SimpleSelect
        aria-label="Rotor"
        placeholder="Pick a rotor"
        groups={[{ label: 'Rotors', options: [{ value: 'I', label: 'I' }] }]}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'Rotor' })).toHaveTextContent('Pick a rotor')
  })
})

describe('Switch', () => {
  it('toggles when the label is clicked (controlled)', async () => {
    const onChange = vi.fn()
    function Harness() {
      const [on, setOn] = useState(false)
      return (
        <Switch
          label="Animate"
          checked={on}
          onCheckedChange={(v) => {
            setOn(v)
            onChange(v)
          }}
        />
      )
    }
    render(<Harness />)
    const sw = screen.getByRole('switch', { name: 'Animate' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByText('Animate'))
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(onChange).toHaveBeenNthCalledWith(1, true)
    expect(onChange).toHaveBeenNthCalledWith(2, false)
  })

  it('renders without a label (uncontrolled)', async () => {
    render(<Switch aria-label="Group" defaultChecked />)
    const sw = screen.getByRole('switch', { name: 'Group' })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Cell', () => {
  it('marks the active cell with the black border + shadow', () => {
    render(
      <CellRow data-testid="row">
        <Cell>A</Cell>
        <Cell active>B</Cell>
        <Cell highlighted>C</Cell>
      </CellRow>,
    )
    const a = screen.getByText('A')
    const b = screen.getByText('B')
    expect(a).not.toHaveAttribute('data-active')
    expect(a.className).toContain('border-border')
    expect(a.className).not.toContain('shadow-cell')
    expect(b).toHaveAttribute('data-active')
    expect(b.className).toContain('border-fg-emphasis')
    expect(b.className).toContain('shadow-cell')
    expect(b.className).toContain('z-10')
    expect(screen.getByText('C').className).toContain('bg-surface-2')
    expect(screen.getByTestId('row').className).toContain('[&>*:not(:first-child)]:-ml-0.5')
  })

  it('can render as a button', () => {
    render(
      <Cell asChild active>
        <button type="button">Q</button>
      </Cell>,
    )
    expect(screen.getByRole('button', { name: 'Q' })).toHaveAttribute('data-active')
  })
})

describe('misc', () => {
  it('renders Field + InputGroup with a count badge', () => {
    render(
      <Field label="Plugboard:" htmlFor="plugs" hint="Pairs like AB CD">
        <InputGroup>
          <Input id="plugs" defaultValue="AB CD" />
          <InputGroupText>2/13</InputGroupText>
        </InputGroup>
      </Field>,
    )
    expect(screen.getByLabelText('Plugboard:')).toHaveValue('AB CD')
    expect(screen.getByText('2/13')).toBeInTheDocument()
    expect(screen.getByText('Pairs like AB CD')).toBeInTheDocument()
  })

  it('renders ToggleGroup, Badge and Hint without a TooltipProvider', async () => {
    render(
      <>
        <ToggleGroup type="single" defaultValue="number" aria-label="Ring display">
          <ToggleGroupItem value="number">01</ToggleGroupItem>
          <ToggleGroupItem value="letter">A</ToggleGroupItem>
        </ToggleGroup>
        <Hint content="Signal in">
          <Badge variant="signal-in">K</Badge>
        </Hint>
      </>,
    )
    const letter = screen.getByRole('radio', { name: 'A' })
    expect(letter).toHaveAttribute('data-state', 'off')
    await userEvent.click(letter)
    expect(letter).toHaveAttribute('data-state', 'on')
    expect(screen.getByText('K').className).toContain('bg-signal-in')
  })
})

describe('InfoTip', () => {
  it('opens an explanation popover from the "?" button', async () => {
    render(<InfoTip label="Model">Which Enigma variant to emulate.</InfoTip>)
    expect(screen.queryByText('Which Enigma variant to emulate.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'About Model' }))
    expect(screen.getByRole('dialog', { name: 'Model' })).toHaveTextContent(
      'Which Enigma variant to emulate.',
    )
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on mouse hover, closes on leave, and a click pins it open', async () => {
    const user = userEvent.setup()
    render(<InfoTip label="Reflector">Sends the signal back.</InfoTip>)
    const trigger = screen.getByRole('button', { name: 'About Reflector' })

    await user.hover(trigger)
    expect(await screen.findByRole('dialog', { name: 'Reflector' })).toBeInTheDocument()
    // Hover-opened: focus stays where it was.
    expect(trigger).not.toHaveFocus()
    await user.unhover(trigger)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.hover(trigger)
    await screen.findByRole('dialog')
    await user.click(trigger)
    await user.unhover(trigger)
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.getByRole('dialog')).toHaveTextContent('Sends the signal back.')

    await user.click(trigger)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is added after Field and Switch labels via `info`, keeping the label association', async () => {
    render(
      <>
        <Field label="Plugboard:" htmlFor="pb" info="Swaps letter pairs.">
          <Input id="pb" />
        </Field>
        <Switch label="Animate" info="Plays the signal path." />
      </>,
    )
    expect(screen.getByLabelText('Plugboard:')).toHaveAttribute('id', 'pb')
    expect(screen.getByRole('switch', { name: 'Animate' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'About Plugboard' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Swaps letter pairs.')
    expect(screen.getByRole('button', { name: 'About Animate' })).toBeInTheDocument()
  })
})
