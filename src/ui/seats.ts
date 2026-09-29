/** One colour per seat in the frozen order, next to the symbol of that seat. */

const COLORS = [
  '#6ea8fe',
  '#f07178',
  '#59c88a',
  '#f0cd8a',
  '#c792ea',
  '#4dd0e1',
  '#ff9e64',
  '#f78fb3',
  '#c3e88d',
  '#b0bec5',
  '#ffd54f',
  '#90caf9',
]

export function seatColor(seat: number): string {
  if (seat < 0) return 'inherit'
  return COLORS[seat % COLORS.length]!
}
