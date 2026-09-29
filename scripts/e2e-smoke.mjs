/**
 * End to end smoke test. Runs a local broker, serves the build and plays two
 * rounds with three browsers on a 4x4 grid.
 *
 * Run: npm run build && node scripts/e2e-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { Aedes } from 'aedes'
import { WebSocketServer, createWebSocketStream } from 'ws'
import { chromium } from 'playwright'

const BROKER_PORT = 1884
const APP_PORT = 4173
const APP_URL = `http://127.0.0.1:${APP_PORT}/galo-multiplayer/`
const BROKER_URL = `ws://127.0.0.1:${BROKER_PORT}`
const ROOM = 'sala de teste'
const KEY = 'chave-secreta'
const broker = await Aedes.createBroker()
const http = createServer()
new WebSocketServer({
  server: http,
  handleProtocols: (protocols) => (protocols.has('mqtt') ? 'mqtt' : false),
}).on('connection', (socket) => broker.handle(createWebSocketStream(socket)))
await new Promise((resolve) => http.listen(BROKER_PORT, resolve))

const preview = spawn('npx', ['vite', 'preview', '--port', String(APP_PORT), '--strictPort'], {
  // A pipe held open by the child would block the caller after this exits.
  stdio: 'ignore',
})
process.on('exit', () => preview.kill('SIGKILL'))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    preview.kill('SIGKILL')
    process.exit(1)
  })
}
await waitForApp()

// The sandbox ships one Chromium build. Use it instead of a download.
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--no-sandbox'],
})
const failures = []
try {
  const host = await newPage(browser, 'ana')
  const guest = await newPage(browser, 'bruno')
  const third = await newPage(browser, 'carla')

  await enter(host, 'ana', 'Criar sala')
  await enter(guest, 'bruno', 'Entrar')
  // The third player picks the room from the open list, so the join uses the
  // published room identifier and never derives one from the name.
  await enterFromList(third, 'carla')

  await host.getByText('bruno').first().waitFor({ timeout: 15000 })
  await host.getByText('carla').first().waitFor({ timeout: 15000 })
  check('every player is on the roster', (await host.locator('.player').count()) === 3)
  check('three players get a 4x4 grid', await host.getByText('a grelha é 4×4').isVisible())
  await host.getByRole('button', { name: 'Começar o jogo' }).click()

  const pages = [
    { page: host, name: 'ana' },
    { page: guest, name: 'bruno' },
    { page: third, name: 'carla' },
  ]
  for (const entry of pages) await entry.page.locator('.grid').waitFor({ timeout: 15000 })
  check('the grid has 16 cells', (await guest.locator('.cell').count()) === 16)
  const symbols = await host.locator('.player__symbol').allInnerTexts()
  check('each player has an own symbol', new Set(symbols).size === 3)

  const first = await findTurn(pages)
  const waiting = pages.find((entry) => entry !== first)
  check(
    'a player off turn cannot play',
    (await waiting.page.locator('.cell:not([disabled])').count()) === 0,
  )

  // Seat 1 takes the top row. Seat 2 and seat 3 never get three in a row.
  const round1 = await playCells(pages, [0, 4, 8, 1, 5, 9, 2])
  check('the turn rotates over three players', new Set(round1.slice(0, 3)).size === 3)
  await guest.getByText(`${round1[0]} ganhou.`).waitFor({ timeout: 10000 })
  check('the winning line is marked', (await third.locator('.cell--win').count()) === 3)
  check('a win makes a sound', (await tones(third)) > 0)
  check('the host applied one point', (await totalScore(host)) === 1)

  await host.getByRole('button', { name: 'Próxima ronda' }).click()
  await guest.getByText('Ronda 2').waitFor({ timeout: 10000 })
  await guest.waitForFunction(() => document.querySelectorAll('.cell:not(:empty)').length === 0, null, {
    timeout: 10000,
  })
  check('the new round starts on an empty grid', true)

  // Round two opens with the next seat of the frozen order.
  const round2 = await playCells(pages, [15, 3, 12, 14, 7, 0, 13])
  check('the next seat opens round two', round2[0] === round1[1])
  await third.getByText(`${round2[0]} ganhou.`).waitFor({ timeout: 10000 })
  check('the second round also scored', (await totalScore(host)) === 2)

  await third.getByRole('button', { name: /Histórico/ }).click()
  await third.getByRole('heading', { name: 'Rondas anteriores' }).waitFor({ timeout: 10000 })
  check('the history lists both rounds', (await third.locator('.history__row').count()) === 2)
  await third.getByRole('button', { name: 'Fechar' }).click()

  // A restart returns the room to the lobby with the same people in it.
  await host.getByRole('button', { name: 'Reiniciar a sala' }).click()
  await third.getByRole('heading', { name: 'À espera de jogadores' }).waitFor({ timeout: 10000 })
  check('a restart keeps every player', (await host.locator('.player').count()) === 3)
  check('a restart clears the scores', (await totalScore(host)) === 0)
  check('a restart clears the board', (await third.locator('.grid').count()) === 0)

  // The Last Will closes the room when the host connection dies.
  await host.context().close()
  await third.getByText('O anfitrião saiu. A sala fechou.').waitFor({ timeout: 20000 })
  check('a lost host closes the room', true)
} catch (error) {
  failures.push(`threw: ${error.message}`)
} finally {
  await browser.close()
  preview.kill('SIGKILL')
  http.close()
  broker.close()
}

if (failures.length > 0) {
  console.error('\nFAILED')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('\ne2e smoke: pass')
process.exit(0)

function check(label, condition) {
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`)
  if (!condition) failures.push(label)
}

async function newPage(browser, label) {
  const context = await browser.newContext()
  // Counts the cues without needing an audio device.
  await context.addInitScript(() => {
    window.__tones = []
    const proto = window.AudioContext && window.AudioContext.prototype
    if (!proto) return
    const create = proto.createOscillator
    proto.createOscillator = function () {
      const osc = create.call(this)
      const start = osc.start.bind(osc)
      osc.start = (...args) => {
        window.__tones.push(1)
        return start(...args)
      }
      return osc
    }
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[${label}] ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    failures.push(`[${label}] page error: ${error.message}`)
  })
  await page.goto(APP_URL)
  return page
}

async function enter(page, name, button) {
  await page.getByLabel('Nome da sala').fill(ROOM)
  await page.getByLabel('Chave da sala').fill(KEY)
  await page.getByLabel('O seu nome').fill(name)
  await page.getByRole('button', { name: 'Broker e credenciais' }).click()
  await page.getByLabel('Broker (WSS)').fill(BROKER_URL)
  await page.getByRole('button', { name: button }).click()
  await page.getByRole('button', { name: /Fechar a sala|Sair/ }).waitFor({ timeout: 20000 })
}

/** Enters through the open room list instead of typing the room name. */
async function enterFromList(page, name) {
  await page.getByRole('button', { name: 'Broker e credenciais' }).click()
  await page.getByLabel('Broker (WSS)').fill(BROKER_URL)
  await page.getByRole('button', { name: new RegExp(ROOM) }).click({ timeout: 25000 })
  await page.getByLabel('Chave da sala').fill(KEY)
  await page.getByLabel('O seu nome').fill(name)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await page.getByRole('button', { name: /Fechar a sala|Sair/ }).waitFor({ timeout: 20000 })
}

/** The page that shows "É a sua vez." Only one page may show it. */
async function findTurn(pages) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const mine = []
    for (const entry of pages) {
      if (await entry.page.getByText('É a sua vez.').isVisible()) mine.push(entry)
    }
    if (mine.length > 1) throw new Error('two devices hold the turn')
    if (mine.length === 1) return mine[0]
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('no device holds the turn')
}

/** Plays the cells in turn order. Waits until each mark reaches every page. */
async function playCells(pages, cells) {
  const seats = []
  for (const [index, cell] of cells.entries()) {
    const entry = await findTurn(pages)
    seats.push(entry.name)
    await entry.page.locator('.cell').nth(cell).click()
    for (const other of pages) {
      await other.page.waitForFunction(
        (count) => document.querySelectorAll('.cell:not(:empty)').length === count,
        index + 1,
        { timeout: 10000 },
      )
    }
  }
  return seats
}

function tones(page) {
  return page.evaluate(() => window.__tones.length)
}

async function totalScore(page) {
  const scores = await page.locator('.player__score').allInnerTexts()
  return scores.reduce((sum, value) => sum + Number(value), 0)
}

async function waitForApp() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(APP_URL)
      if (response.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('the preview server did not start')
}
