#!/usr/bin/env node
/**
 * Publish all npm packages (platform-specific and main).
 *
 * Called after electron-builder completes:
 *   node ./scripts/publish-npm.js <version>
 *
 * This script:
 * 1. Iterates over all platforms defined in platforms.json
 * 2. Copies Electron app binaries and publishes each platform package
 * 3. Updates and publishes the main openwork package
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT_DIR = path.resolve(__dirname, '..')
const NPM_DIR = path.join(ROOT_DIR, 'distributions/npm')
const PLATFORMS_DIR = path.join(NPM_DIR, 'platforms')
const RELEASE_DIR = path.join(ROOT_DIR, 'release')

// Read shared platform config
const platformsConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'platforms.json'), 'utf8'))

function log(msg) {
  console.log(msg)
}

function error(msg) {
  console.error(`::error::${msg}`)
}

function success(msg) {
  console.log(`✅ ${msg}`)
}

/**
 * Calculate SHA256 checksum
 */
function sha256(filePath) {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Read and parse a package.json file
 */
function readPackageJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null
  }
  const content = fs.readFileSync(filePath, 'utf8')
  if (!content || content.trim() === '') {
    throw new Error(`File is empty: ${filePath}`)
  }
  try {
    return JSON.parse(content)
  } catch (err) {
    throw new Error(`Failed to parse JSON in ${filePath}: ${err.message}`)
  }
}

/**
 * Write package.json
 */
function writePackageJson(filePath, pkg) {
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * Create .npmrc file for authentication
 */
function ensureNpmAuth(pkgDir) {
  const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN
  if (!token) {
    return false
  }
  const npmrcPath = path.join(pkgDir, '.npmrc')
  const npmrcContent = `//registry.npmjs.org/:_authToken=${token}\n`
  fs.writeFileSync(npmrcPath, npmrcContent)
  return true
}

/**
 * Publish a package to npm
 */
function publishPackage(pkgDir, pkgName) {
  try {
    // Ensure npm authentication is configured
    if (!ensureNpmAuth(pkgDir)) {
      return {
        success: false,
        skipped: false,
        error: 'NPM_TOKEN or NODE_AUTH_TOKEN environment variable not set'
      }
    }

    const args = ['publish', '--access', 'public']
    if (process.env.GITHUB_ACTIONS) {
      args.push('--provenance')
    }

    execSync(`npm ${args.join(' ')}`, {
      cwd: pkgDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    return { success: true, skipped: false }
  } catch (err) {
    const output = err.stderr?.toString() || err.stdout?.toString() || ''

    if (/previously published|cannot publish over|already exists|EPUBLISHCONFLICT/i.test(output)) {
      return { success: true, skipped: true }
    }

    return { success: false, skipped: false, error: output }
  }
}

/**
 * Copy directory recursively (handles symlinks)
 */
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isSymbolicLink()) {
      // Copy symlinks as symlinks
      const linkTarget = fs.readlinkSync(srcPath)
      fs.symlinkSync(linkTarget, destPath)
    } else if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Publish a single platform package
 */
function publishPlatformPackage(version, platformId, config) {
  const npmKey = config.npm.key
  const releaseSubDir = config.electronBuilder.releaseDir
  const appBundle = config.electronBuilder.appBundle

  log(`\n📦 Publishing @langchain/openwork-${npmKey}...`)

  // Find the electron-builder output
  const sourceDir = path.join(RELEASE_DIR, releaseSubDir)
  if (!fs.existsSync(sourceDir)) {
    error(`Release directory not found: ${sourceDir}`)

    // List what's in release for debugging
    if (fs.existsSync(RELEASE_DIR)) {
      const entries = fs.readdirSync(RELEASE_DIR)
      log(`Contents of ${RELEASE_DIR}:`)
      for (const e of entries.slice(0, 15)) {
        log(`  ${e}`)
      }
    }
    return false
  }

  // Prepare platform package
  const platformDir = path.join(PLATFORMS_DIR, npmKey)
  const packageJsonPath = path.join(platformDir, 'package.json')

  const pkg = readPackageJson(packageJsonPath)
  if (!pkg) {
    error(`package.json not found: ${packageJsonPath}`)
    return false
  }

  // Clear and recreate bin directory
  const binDir = path.join(platformDir, 'bin')
  if (fs.existsSync(binDir)) {
    fs.rmSync(binDir, { recursive: true })
  }
  fs.mkdirSync(binDir, { recursive: true })

  // Copy the app
  if (appBundle) {
    // macOS: copy the .app bundle
    const appBundleSrc = path.join(sourceDir, appBundle)
    const appBundleDest = path.join(binDir, appBundle)

    if (!fs.existsSync(appBundleSrc)) {
      error(`App bundle not found: ${appBundleSrc}`)
      return false
    }

    log(`Copying ${appBundleSrc} -> ${appBundleDest}`)
    copyDir(appBundleSrc, appBundleDest)
  } else {
    // Linux/Windows: copy the entire unpacked directory
    log(`Copying ${sourceDir} -> ${binDir}`)
    copyDir(sourceDir, binDir)
  }

  // Verify binary exists
  const binaryPath = path.join(binDir, config.npm.binaryPath)
  if (!fs.existsSync(binaryPath)) {
    error(`Binary not found: ${binaryPath}`)
    return false
  }

  const stats = fs.statSync(binaryPath)
  if (stats.size === 0) {
    error(`Binary is empty: ${binaryPath}`)
    return false
  }

  // Set executable permissions on Unix
  if (platformId.startsWith('darwin') || platformId.startsWith('linux')) {
    fs.chmodSync(binaryPath, 0o755)
  }

  const binaryHash = sha256(binaryPath)
  log(`Binary: ${binaryPath} (${stats.size} bytes, sha256: ${binaryHash.substring(0, 12)}...)`)

  // Update version
  pkg.version = version
  writePackageJson(packageJsonPath, pkg)

  // Publish
  const result = publishPackage(platformDir, `@langchain/openwork-${npmKey}`)

  if (result.success) {
    if (result.skipped) {
      log(`⚠️  @langchain/openwork-${npmKey}@${version} already exists, skipped`)
    } else {
      success(`Published @langchain/openwork-${npmKey}@${version}`)
    }
    return true
  } else {
    error(`Failed to publish @langchain/openwork-${npmKey}`)
    if (result.error) {
      console.error(result.error)
    }
    return false
  }
}

/**
 * Publish the main openwork package
 */
function publishMainPackage(version) {
  log(`\n📦 Publishing main openwork package...`)

  // Read main package.json
  const packageJsonPath = path.join(NPM_DIR, 'package.json')
  const pkg = readPackageJson(packageJsonPath)

  if (!pkg) {
    error(`Main package.json not found: ${packageJsonPath}`)
    return false
  }

  // Update version
  pkg.version = version

  // Update optionalDependencies versions
  if (!pkg.optionalDependencies) {
    pkg.optionalDependencies = {}
  }
  for (const config of Object.values(platformsConfig.platforms)) {
    pkg.optionalDependencies[`@langchain/openwork-${config.npm.key}`] = version
  }

  writePackageJson(packageJsonPath, pkg)
  log(`Updated package.json with version ${version}`)

  // Publish
  const result = publishPackage(NPM_DIR, 'openwork')

  if (result.success) {
    if (result.skipped) {
      log(`⚠️  openwork@${version} already exists, skipped`)
    } else {
      success(`Published openwork@${version}`)
    }
    return true
  } else {
    error('Failed to publish openwork')
    if (result.error) {
      console.error(result.error)
    }
    return false
  }
}

/**
 * Update the root package.json version (for consistency)
 */
function updateRootPackageVersion(version) {
  const packageJsonPath = path.join(ROOT_DIR, 'package.json')
  const pkg = readPackageJson(packageJsonPath)

  if (pkg) {
    pkg.version = version
    writePackageJson(packageJsonPath, pkg)
    log(`Updated root package.json to version ${version}`)
  }
}

async function main() {
  const version = process.argv[2]

  if (!version) {
    console.error('Usage: publish-npm.js <version>')
    console.error('Example: publish-npm.js 0.1.0')
    process.exit(1)
  }

  log(`🚀 Publishing npm packages v${version}`)
  log(`================================================`)

  // Update root package.json for consistency
  updateRootPackageVersion(version)

  // Publish all platform packages first
  let allSucceeded = true
  const platforms = Object.entries(platformsConfig.platforms)

  log(`\nPublishing ${platforms.length} platform packages...`)

  for (const [platformId, config] of platforms) {
    const succeeded = publishPlatformPackage(version, platformId, config)
    if (!succeeded) {
      allSucceeded = false
      // Continue with other platforms even if one fails
    }
  }

  if (!allSucceeded) {
    error('Some platform packages failed to publish')
    process.exit(1)
  }

  // Publish main package after all platforms succeed
  log(`\n================================================`)
  const mainSucceeded = publishMainPackage(version)

  if (!mainSucceeded) {
    process.exit(1)
  }

  log(`\n================================================`)
  success('All npm packages published successfully!')
}

main().catch((err) => {
  error(err.message)
  process.exit(1)
})
