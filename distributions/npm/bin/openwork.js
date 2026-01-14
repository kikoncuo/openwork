#!/usr/bin/env node

const { spawn } = require('child_process')

// Supported platforms - the package name is @openwork/${platform}
const SUPPORTED_PLATFORMS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64'
])

function getBinaryPath() {
  const platformKey = `${process.platform}-${process.arch}`

  if (!SUPPORTED_PLATFORMS.has(platformKey)) {
    console.error(`Unsupported platform: ${platformKey}`)
    console.error('')
    console.error('Supported platforms:')
    for (const p of SUPPORTED_PLATFORMS) {
      console.error(`  - ${p}`)
    }
    console.error('')
    console.error('You can download the app directly from:')
    console.error('  https://github.com/langchain-ai/openwork/releases/latest')
    process.exit(1)
  }

  const pkgName = `@langchain/openwork-${platformKey}`

  try {
    // The platform package exports the binary path
    return require(pkgName)
  } catch (err) {
    console.error(`Failed to load platform package: ${pkgName}`)
    console.error('')
    console.error("This usually means the package wasn't installed correctly.")
    console.error('Try reinstalling:')
    console.error('  npm uninstall openwork && npm install openwork')
    console.error('')
    console.error('Or download directly:')
    console.error('  https://github.com/langchain-ai/openwork/releases/latest')
    process.exit(1)
  }
}

const binaryPath = getBinaryPath()

// Spawn the Electron app
const child = spawn(binaryPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  detached: process.platform !== 'win32'
})

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(`Binary not found: ${binaryPath}`)
    console.error('Try reinstalling: npm install -g openwork')
  } else if (err.code === 'EACCES') {
    console.error(`Permission denied: ${binaryPath}`)
    console.error(`Try: chmod +x "${binaryPath}"`)
  } else {
    console.error(`Failed to start openwork: ${err.message}`)
  }
  process.exit(1)
})

child.on('close', (code, signal) => {
  if (signal) {
    process.exit(128 + (signal === 'SIGINT' ? 2 : signal === 'SIGTERM' ? 15 : 1))
  }
  process.exit(code ?? 0)
})

// Forward signals
const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

// Allow parent to exit (for detached mode on Unix)
if (process.platform !== 'win32') {
  child.unref()
}
