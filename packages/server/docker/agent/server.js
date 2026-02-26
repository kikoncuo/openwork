// packages/server/docker/agent/server.js
// Sandbox Agent API server with CORS for browser access

const express = require('express')
const cors = require('cors')
const { WebSocketServer } = require('ws')
const { spawn } = require('child_process')
const fs = require('fs').promises
const path = require('path')
const { execSync } = require('child_process')
const http = require('http')

const app = express()

// CORS for browser access from any origin
app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '50mb' }))

const DEFAULT_WORKSPACE = process.env.WORKSPACE || '/home/user'

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    workspace: DEFAULT_WORKSPACE,
    version: '1.0.0'
  })
})

// Helper to resolve path within workspace
// Remaps /home/user paths to per-agent workspace
function resolveWorkspacePath(inputPath, workspace) {
  if (!inputPath) return workspace

  // Exact match: /home/user -> workspace
  if (inputPath === '/home/user') {
    return workspace
  }

  // Prefix match: /home/user/foo -> workspace/foo
  // Uses trailing slash to avoid matching /home/username
  if (inputPath.startsWith('/home/user/')) {
    return workspace + inputPath.slice('/home/user'.length)
  }

  // Relative paths -> workspace/path
  if (!path.isAbsolute(inputPath)) {
    return path.join(workspace, inputPath)
  }

  // System paths (like /etc) pass through unchanged
  return inputPath
}

// Helper to convert real paths back to virtual paths for the agent
// Converts /home/user/{agentId}/foo -> /home/user/foo
function toVirtualPath(realPath, workspace) {
  if (!realPath || workspace === DEFAULT_WORKSPACE) return realPath

  if (realPath === workspace) {
    return '/home/user'
  }

  if (realPath.startsWith(workspace + '/')) {
    return '/home/user' + realPath.slice(workspace.length)
  }

  return realPath
}

// Directories to skip during recursive listing (matches Electron app behavior)
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.cache', '.venv', 'venv'])
const MAX_RECURSIVE_FILES = 5000

// List directory contents
app.post('/ls', async (req, res) => {
  try {
    const workspace = req.body.workspace || DEFAULT_WORKSPACE
    const dirPath = resolveWorkspacePath(req.body.path, workspace) || workspace
    const recursive = req.body.recursive || false

    // Ensure workspace directory exists (for per-agent isolation)
    await fs.mkdir(workspace, { recursive: true }).catch(() => {})

    if (recursive) {
      // Recursive listing for file explorer (skip heavy dirs, cap at MAX_RECURSIVE_FILES)
      const allFiles = []
      async function walkDir(dir) {
        if (allFiles.length >= MAX_RECURSIVE_FILES) return
        let entries
        try {
          entries = await fs.readdir(dir, { withFileTypes: true })
        } catch {
          return // Skip unreadable directories
        }
        for (const entry of entries) {
          if (allFiles.length >= MAX_RECURSIVE_FILES) return
          // Skip hidden files/folders and known heavy directories
          if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
          const fullPath = path.join(dir, entry.name)
          const stat = await fs.stat(fullPath).catch(() => null)
          const isDir = entry.isDirectory()
          allFiles.push({
            path: toVirtualPath(fullPath, workspace),
            name: entry.name,
            is_dir: isDir,
            size: stat?.size || 0,
            modified_at: stat?.mtime?.toISOString()
          })
          if (isDir) {
            await walkDir(fullPath)
          }
        }
      }
      await walkDir(dirPath)
      return res.json({ success: true, files: allFiles })
    }

    // Non-recursive (default): immediate children only
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    const files = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      const stat = await fs.stat(fullPath).catch(() => null)
      return {
        path: toVirtualPath(fullPath, workspace),
        name: entry.name,
        is_dir: entry.isDirectory(),
        size: stat?.size || 0,
        modified_at: stat?.mtime?.toISOString()
      }
    }))

    res.json({ success: true, files })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

// Read file contents with line numbers
app.post('/read', async (req, res) => {
  try {
    const { path: filePath, offset = 0, limit = 500, workspace = DEFAULT_WORKSPACE } = req.body

    // Resolve path within the workspace
    const resolvedPath = resolveWorkspacePath(filePath, workspace)

    // Binary mode: return base64-encoded content
    if (req.body.binary) {
      const buffer = await fs.readFile(resolvedPath)
      return res.json({
        success: true,
        content: buffer.toString('base64'),
        encoding: 'base64'
      })
    }

    const content = await fs.readFile(resolvedPath, 'utf-8')
    const lines = content.split('\n')
    const slice = lines.slice(offset, offset + limit)

    // Format with line numbers (cat -n style)
    const numbered = slice.map((line, i) => `${offset + i + 1}\t${line}`).join('\n')

    res.json({
      success: true,
      content: numbered,
      totalLines: lines.length,
      returnedLines: slice.length
    })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

// Write file contents
app.post('/write', async (req, res) => {
  try {
    const { path: filePath, content, workspace = DEFAULT_WORKSPACE } = req.body

    // Resolve path within the workspace
    const resolvedPath = resolveWorkspacePath(filePath, workspace)

    // Create parent directories if they don't exist
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true })
    await fs.writeFile(resolvedPath, content)

    res.json({ success: true, path: toVirtualPath(resolvedPath, workspace) })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

// Edit file with string replacement
app.post('/edit', async (req, res) => {
  try {
    const { path: filePath, oldString, newString, replaceAll = false, workspace = DEFAULT_WORKSPACE } = req.body

    // Resolve path within the workspace
    const resolvedPath = resolveWorkspacePath(filePath, workspace)

    let content = await fs.readFile(resolvedPath, 'utf-8')

    // Escape special regex characters in oldString for counting
    const escapedOldString = oldString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escapedOldString, 'g')
    const occurrences = (content.match(regex) || []).length

    if (occurrences === 0) {
      return res.json({
        success: false,
        error: 'String to replace not found in file'
      })
    }

    // Perform replacement
    if (replaceAll) {
      content = content.replaceAll(oldString, newString)
    } else {
      content = content.replace(oldString, newString)
    }

    await fs.writeFile(resolvedPath, content)

    res.json({
      success: true,
      path: toVirtualPath(resolvedPath, workspace),
      occurrences,
      replaced: replaceAll ? occurrences : 1
    })
  } catch (error) {
    res.json({ success: false, error: error.message })
  }
})

// Grep search using ripgrep
app.post('/grep', async (req, res) => {
  try {
    const { pattern, path: searchPath, glob, caseSensitive = true, maxResults = 100, workspace = DEFAULT_WORKSPACE } = req.body

    const targetPath = resolveWorkspacePath(searchPath, workspace) || workspace
    const args = ['-n', '--json']

    if (!caseSensitive) {
      args.push('-i')
    }

    if (glob) {
      args.push('-g', glob)
    }

    args.push(pattern, targetPath)

    let result = ''
    try {
      result = execSync(`rg ${args.map(a => `'${a}'`).join(' ')} 2>/dev/null || true`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024
      }).trim()
    } catch {
      // ripgrep returns exit code 1 when no matches found
      result = ''
    }

    const matches = result.split('\n')
      .filter(line => line.startsWith('{'))
      .slice(0, maxResults)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(obj => obj && obj.type === 'match')
      .map(obj => ({
        path: toVirtualPath(obj.data.path.text, workspace),
        line: obj.data.line_number,
        text: obj.data.lines.text.trim()
      }))

    res.json({ success: true, matches })
  } catch (error) {
    res.json({ success: true, matches: [] })
  }
})

// Convert a glob pattern to a RegExp with correct ** handling
// ** means zero or more directory levels, * means within one segment
function globToRegex(pattern) {
  let regex = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        regex += '(?:.*/)?'
        i += 3
      } else {
        regex += '.*'
        i += 2
      }
    } else if (pattern[i] === '*') {
      regex += '[^/]*'
      i++
    } else if (pattern[i] === '?') {
      regex += '[^/]'
      i++
    } else if ('.+^${}()|[]\\'.includes(pattern[i])) {
      regex += '\\' + pattern[i]
      i++
    } else {
      regex += pattern[i]
      i++
    }
  }
  return new RegExp('^' + regex + '$')
}

// Glob file matching
app.post('/glob', async (req, res) => {
  try {
    const { pattern, path: basePath, workspace = DEFAULT_WORKSPACE } = req.body
    const targetPath = resolveWorkspacePath(basePath, workspace) || workspace

    const result = execSync(
      `find ${targetPath} -type f 2>/dev/null | head -5000`,
      { encoding: 'utf-8' }
    ).trim()

    if (!result) {
      return res.json({ success: true, files: [] })
    }

    const allFiles = result.split('\n').filter(Boolean)
    const regex = globToRegex(pattern)

    const files = allFiles
      .filter(f => {
        const relativePath = f.substring(targetPath.length).replace(/^\//, '')
        return regex.test(relativePath)
      })
      .slice(0, 1000)
      .map(p => ({
        path: toVirtualPath(p, workspace),
        is_dir: false,
        name: path.basename(p)
      }))

    res.json({ success: true, files })
  } catch (error) {
    res.json({ success: true, files: [] })
  }
})

// Create HTTP server
const server = http.createServer(app)

// WebSocket server for streaming command execution
const wss = new WebSocketServer({
  server,
  path: '/execute'
})

wss.on('connection', (ws) => {
  console.log('[WS] New execute connection')

  ws.on('message', (data) => {
    try {
      const { command, cwd, timeout = 120000, workspace = DEFAULT_WORKSPACE } = JSON.parse(data)

      // Use cwd if provided, otherwise use workspace
      const workingDir = cwd ? resolveWorkspacePath(cwd, workspace) : workspace

      // Calculate the working directory inside the bwrap sandbox
      // workspace (e.g., /home/user/abc123) is mounted as /home/user inside bwrap
      let bwrapCwd = '/home/user'
      if (workingDir !== workspace && workingDir.startsWith(workspace)) {
        bwrapCwd = '/home/user' + workingDir.slice(workspace.length)
      }

      console.log(`[WS] Executing: ${command}`)
      console.log(`[WS] Working directory: ${workingDir} -> ${bwrapCwd} (inside bwrap)`)
      console.log(`[WS] Workspace: ${workspace}`)

      // Use bubblewrap for filesystem isolation
      // This binds the agent's workspace to /home/user, providing true isolation
      const proc = spawn('bwrap', [
        // Mount system directories
        // /usr is writable to allow apt-get to install packages
        // Packages are shared across all agents in the container
        '--bind', '/usr', '/usr',
        '--ro-bind', '/lib', '/lib',
        '--ro-bind', '/bin', '/bin',
        '--ro-bind', '/sbin', '/sbin',
        '--ro-bind', '/etc', '/etc',
        '--ro-bind', '/opt', '/opt',
        // Mount /lib64 if it exists (needed on some systems)
        '--ro-bind-try', '/lib64', '/lib64',
        // Mount proc and dev
        '--proc', '/proc',
        '--dev', '/dev',
        // Provide a writable /tmp and /var/tmp for apt
        '--bind', '/tmp', '/tmp',
        '--bind', '/var/tmp', '/var/tmp',
        // Mount /var directories for apt-get functionality
        // These are shared across all agents in the container
        '--bind', '/var/lib/apt', '/var/lib/apt',
        '--bind', '/var/cache/apt', '/var/cache/apt',
        '--bind', '/var/lib/dpkg', '/var/lib/dpkg',
        '--bind', '/var/log', '/var/log',
        // CRITICAL: Bind agent's workspace to /home/user for isolation
        '--bind', workspace, '/home/user',
        // Set working directory and environment
        '--chdir', bwrapCwd,
        '--setenv', 'HOME', '/home/user',
        '--setenv', 'PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        // Run the command
        '/bin/bash', '-c', command
      ], { env: process.env })

      let killed = false
      let outputSize = 0
      const MAX_OUTPUT = 1024 * 1024 // 1MB limit

      // Set timeout for command execution
      const timer = setTimeout(() => {
        killed = true
        proc.kill('SIGTERM')
        ws.send(JSON.stringify({
          type: 'stderr',
          data: `\n[Command timed out after ${timeout / 1000}s]\n`
        }))
      }, timeout)

      proc.stdout.on('data', (chunk) => {
        const data = chunk.toString()
        outputSize += data.length
        console.log(`[WS] stdout: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`)

        if (outputSize > MAX_OUTPUT) {
          ws.send(JSON.stringify({
            type: 'stderr',
            data: '\n[Output truncated - exceeded 1MB limit]\n'
          }))
          proc.kill('SIGTERM')
          return
        }

        ws.send(JSON.stringify({ type: 'stdout', data }))
      })

      proc.stderr.on('data', (chunk) => {
        const data = chunk.toString()
        outputSize += data.length
        console.log(`[WS] stderr: ${data.substring(0, 100)}${data.length > 100 ? '...' : ''}`)

        if (outputSize > MAX_OUTPUT) {
          proc.kill('SIGTERM')
          return
        }

        ws.send(JSON.stringify({ type: 'stderr', data }))
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        console.log(`[WS] Process exited with code: ${code}`)
        ws.send(JSON.stringify({
          type: 'exit',
          code: killed ? null : code,
          truncated: outputSize > MAX_OUTPUT
        }))
        ws.close()
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        ws.send(JSON.stringify({
          type: 'stderr',
          data: `Error: ${err.message}\n`
        }))
        ws.send(JSON.stringify({
          type: 'exit',
          code: 1,
          truncated: false
        }))
        ws.close()
      })

    } catch (error) {
      ws.send(JSON.stringify({
        type: 'stderr',
        data: `Parse error: ${error.message}\n`
      }))
      ws.send(JSON.stringify({ type: 'exit', code: 1 }))
      ws.close()
    }
  })

  ws.on('close', () => {
    console.log('[WS] Connection closed')
  })
})

// Start server
const PORT = process.env.PORT || 8080
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Sandbox agent running on :${PORT}`)
  console.log(`Workspace: ${DEFAULT_WORKSPACE}`)
})
