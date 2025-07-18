import { IpcMain } from 'electron';
import os from 'os';
import type { AppServices } from './types';

export function registerProjectHandlers(ipcMain: IpcMain, services: AppServices): void {
  const { databaseService, sessionManager, worktreeManager, app } = services;

  ipcMain.handle('projects:get-all', async () => {
    try {
      const projects = databaseService.getAllProjects();
      return { success: true, data: projects };
    } catch (error) {
      console.error('Failed to get projects:', error);
      return { success: false, error: 'Failed to get projects' };
    }
  });

  ipcMain.handle('projects:get-active', async () => {
    try {
      const activeProject = sessionManager.getActiveProject();
      return { success: true, data: activeProject };
    } catch (error) {
      console.error('Failed to get active project:', error);
      return { success: false, error: 'Failed to get active project' };
    }
  });

  ipcMain.handle('projects:create', async (_event, projectData: any) => {
    try {
      console.log('[Main] Creating project:', projectData);
      console.log('[Main] Current working directory:', process.cwd());
      console.log('[Main] Project path to create:', projectData.path);

      // Import fs and exec utilities
      const { mkdirSync, existsSync } = require('fs');
      const { execSync: nodeExecSync } = require('child_process');

      // Resolve the absolute path (expand ~ first if needed)
      const { resolve } = require('path');
      let expandedPath = projectData.path;
      if (projectData.path.startsWith('~')) {
        expandedPath = projectData.path.replace('~', os.homedir());
      }
      const absolutePath = resolve(expandedPath);
      console.log('[Main] Resolved absolute path:', absolutePath);
      
      // Create directory if it doesn't exist
      if (!existsSync(absolutePath)) {
        console.log('[Main] Creating directory:', absolutePath);
        mkdirSync(absolutePath, { recursive: true });
      } else {
        console.log('[Main] Directory already exists:', absolutePath);
      }
      
      // Update projectData.path to use the absolute path for git operations
      projectData.path = absolutePath;

      // Check if it's a git repository by looking for .git folder directly
      let isGitRepo = false;
      const gitPath = require('path').join(projectData.path, '.git');
      
      if (existsSync(gitPath)) {
        isGitRepo = true;
        console.log('[Main] Directory is already a git repository (.git folder found at:', gitPath, ')');
      } else {
        console.log('[Main] Directory is not a git repository (.git folder not found), will initialize new repo');
        // Always initialize a new git repository for alpha projects
        // Don't check for parent git repositories as we want isolated repos
        isGitRepo = false;
      }

      // Initialize git if needed
      if (!isGitRepo) {
        try {
          // Test if git is available
          console.log('[Main] Testing git availability...');
          nodeExecSync('git --version', { encoding: 'utf-8' });
          console.log('[Main] Git is available');
          
          // Always use 'main' as the default branch name for new repos
          const branchName = 'main';

          console.log('[Main] Initializing git repository at:', projectData.path);
          const initResult = nodeExecSync('git init', { encoding: 'utf-8', cwd: projectData.path });
          console.log('[Main] Git init result:', initResult);
          console.log('[Main] Git repository initialized successfully');

          // Create and checkout the main branch
          nodeExecSync(`git checkout -b ${branchName}`, { encoding: 'utf-8', cwd: projectData.path });
          console.log(`[Main] Created and checked out branch: ${branchName}`);

          // For alpha projects, copy template files before initial commit
          const isAlphaProjectForGit = projectData.isAlpha || false;
          if (isAlphaProjectForGit) {
            console.log('[Main] Alpha project detected, copying template files before initial commit...');
            try {
              const { readdirSync, copyFileSync, readFileSync, writeFileSync } = require('fs');
              const path = require('path');
              
              // Get the app directory (where templates folder is located)
              const appDir = app.isPackaged 
                ? path.dirname(app.getPath('exe'))
                : process.cwd();
              
              const templatesDir = path.join(appDir, 'templates');
              console.log('[Main] Templates directory:', templatesDir);
              
              if (existsSync(templatesDir)) {
                // Read all files from templates directory
                const templateFiles = readdirSync(templatesDir);
                console.log('[Main] Template files found:', templateFiles);
                
                for (const file of templateFiles) {
                  const sourcePath = path.join(templatesDir, file);
                  let destFileName = file;
                  
                  // Rename initial-core-memory.md to CLAUDE.md
                  if (file === 'initial-core-memory.md') {
                    destFileName = 'CLAUDE.md';
                  }
                  
                  const destPath = path.join(projectData.path, destFileName);
                  
                  if (file === 'README.md') {
                    // Read, replace placeholder, and write
                    let content = readFileSync(sourcePath, 'utf-8');
                    content = content.replace('$ALPHA_NAME', projectData.name);
                    writeFileSync(destPath, content);
                    console.log('[Main] Copied and processed README.md');
                  } else {
                    // Just copy the file
                    copyFileSync(sourcePath, destPath);
                    console.log(`[Main] Copied ${file} as ${destFileName}`);
                  }
                }
                
                // Add all template files to git
                nodeExecSync('git add .', { encoding: 'utf-8', cwd: projectData.path });
                console.log('[Main] Added template files to git');
                
                // Create initial commit with template files
                nodeExecSync('git commit -m "Initial commit with alpha project templates"', { encoding: 'utf-8', cwd: projectData.path });
                console.log('[Main] Created initial commit with template files');
              } else {
                console.log('[Main] Templates directory not found at:', templatesDir);
                // Create empty initial commit if no templates
                nodeExecSync('git commit -m "Initial commit" --allow-empty', { encoding: 'utf-8', cwd: projectData.path });
                console.log('[Main] Created initial empty commit');
              }
            } catch (error) {
              console.error('[Main] Failed to copy template files:', error);
              // Create empty initial commit if template copying fails
              nodeExecSync('git commit -m "Initial commit" --allow-empty', { encoding: 'utf-8', cwd: projectData.path });
              console.log('[Main] Created initial empty commit (template copy failed)');
            }
          } else {
            // For non-alpha projects, create empty initial commit
            nodeExecSync('git commit -m "Initial commit" --allow-empty', { encoding: 'utf-8', cwd: projectData.path });
            console.log('[Main] Created initial empty commit');
          }
          
          // Verify git folder was created
          const gitPath = require('path').join(projectData.path, '.git');
          if (existsSync(gitPath)) {
            console.log('[Main] Verified .git folder exists at:', gitPath);
          } else {
            console.error('[Main] ERROR: .git folder not found at:', gitPath);
          }
        } catch (error) {
          console.error('[Main] Failed to initialize git repository:', error);
          console.error('[Main] Error details:', error);
          // Continue anyway - let the user handle git setup manually if needed
        }
      }

      // Always detect the main branch - never use projectData.mainBranch
      let mainBranch: string | undefined;
      if (isGitRepo) {
        try {
          mainBranch = await worktreeManager.getProjectMainBranch(projectData.path);
          console.log('[Main] Detected main branch:', mainBranch);
        } catch (error) {
          console.log('[Main] Could not detect main branch, skipping:', error);
          // Not a git repository or error detecting, that's okay
        }
      }


      // Check if this is an alpha project and set alpha_view to true by default
      const isAlphaProjectForCreation = projectData.isAlpha || false;
      
      const project = databaseService.createProject(
        projectData.name,
        projectData.path,
        projectData.systemPrompt,
        projectData.runScript,
        projectData.buildScript,
        undefined, // default_permission_mode
        projectData.openIdeCommand,
        undefined, // worktree_folder
        isAlphaProjectForCreation // alpha_view - default to true for alpha projects
      );

      // If run_script was provided, also create run commands
      if (projectData.runScript && project) {
        const commands = projectData.runScript.split('\n').filter((cmd: string) => cmd.trim());
        commands.forEach((command: string, index: number) => {
          databaseService.createRunCommand(
            project.id,
            command.trim(),
            `Command ${index + 1}`,
            index
          );
        });
      }

      console.log('[Main] Project created successfully:', project);
      return { success: true, data: project };
    } catch (error) {
      console.error('[Main] Failed to create project:', error);

      // Extract detailed error information
      let errorMessage = 'Failed to create project';
      let errorDetails = '';
      let command = '';

      if (error instanceof Error) {
        errorMessage = error.message;
        errorDetails = error.stack || error.toString();

        // Check if it's a command error
        const cmdError = error as any;
        if (cmdError.cmd) {
          command = cmdError.cmd;
        }

        // Include command output if available
        if (cmdError.stderr) {
          errorDetails = cmdError.stderr;
        } else if (cmdError.stdout) {
          errorDetails = cmdError.stdout;
        }
      }

      return {
        success: false,
        error: errorMessage,
        details: errorDetails,
        command: command
      };
    }
  });

  ipcMain.handle('projects:activate', async (_event, projectId: string) => {
    try {
      const project = databaseService.setActiveProject(parseInt(projectId));
      if (project) {
        sessionManager.setActiveProject(project);
        // Use "conversations" folder for alpha projects, otherwise use project's worktree_folder setting
        const effectiveWorktreeFolder = project.alpha_view ? 'conversations' : project.worktree_folder;
        await worktreeManager.initializeProject(project.path, effectiveWorktreeFolder);
      }
      return { success: true };
    } catch (error) {
      console.error('Failed to activate project:', error);
      return { success: false, error: 'Failed to activate project' };
    }
  });

  ipcMain.handle('projects:update', async (_event, projectId: string, updates: any) => {
    try {
      // Update the project
      const project = databaseService.updateProject(parseInt(projectId), updates);

      // If run_script was updated, also update the run commands table
      if (updates.run_script !== undefined) {
        const projectIdNum = parseInt(projectId);

        // Delete existing run commands
        databaseService.deleteProjectRunCommands(projectIdNum);

        // Add new run commands from the multiline script
        if (updates.run_script) {
          const commands = updates.run_script.split('\n').filter((cmd: string) => cmd.trim());
          commands.forEach((command: string, index: number) => {
            databaseService.createRunCommand(
              projectIdNum,
              command.trim(),
              `Command ${index + 1}`,
              index
            );
          });
        }
      }

      // Emit event to notify frontend about project update
      if (project) {
        sessionManager.emit('project:updated', project);
      }

      return { success: true, data: project };
    } catch (error) {
      console.error('Failed to update project:', error);
      return { success: false, error: 'Failed to update project' };
    }
  });

  ipcMain.handle('projects:delete', async (_event, projectId: string) => {
    try {
      const projectIdNum = parseInt(projectId);
      
      // Get all sessions for this project to check for running scripts
      const projectSessions = databaseService.getAllSessions(projectIdNum);
      
      // Check if any session from this project has a running script
      const currentRunningSessionId = sessionManager.getCurrentRunningSessionId();
      if (currentRunningSessionId) {
        const runningSession = projectSessions.find(s => s.id === currentRunningSessionId);
        if (runningSession) {
          console.log(`[Main] Stopping running script for session ${currentRunningSessionId} before deleting project`);
          sessionManager.stopRunningScript();
        }
      }
      
      // Close all terminal sessions for this project
      for (const session of projectSessions) {
        if (sessionManager.hasTerminalSession(session.id)) {
          console.log(`[Main] Closing terminal session ${session.id} before deleting project`);
          await sessionManager.closeTerminalSession(session.id);
        }
      }
      
      // Now safe to delete the project
      const success = databaseService.deleteProject(projectIdNum);
      return { success: true, data: success };
    } catch (error) {
      console.error('Failed to delete project:', error);
      return { success: false, error: 'Failed to delete project' };
    }
  });

  ipcMain.handle('projects:reorder', async (_event, projectOrders: Array<{ id: number; displayOrder: number }>) => {
    try {
      databaseService.reorderProjects(projectOrders);
      return { success: true };
    } catch (error) {
      console.error('Failed to reorder projects:', error);
      return { success: false, error: 'Failed to reorder projects' };
    }
  });

  ipcMain.handle('projects:detect-branch', async (_event, path: string) => {
    try {
      const branch = await worktreeManager.getProjectMainBranch(path);
      return { success: true, data: branch };
    } catch (error) {
      console.log('[Main] Could not detect branch:', error);
      return { success: true, data: 'main' }; // Return default if detection fails
    }
  });

  ipcMain.handle('projects:list-branches', async (_event, projectId: string) => {
    try {
      const project = databaseService.getProject(parseInt(projectId));
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const branches = await worktreeManager.listBranches(project.path);
      return { success: true, data: branches };
    } catch (error) {
      console.error('[Main] Failed to list branches:', error);
      return { success: false, error: 'Failed to list branches' };
    }
  });

  ipcMain.handle('projects:generate-avatar', async (_event, projectId: string) => {
    try {
      const project = databaseService.getProject(parseInt(projectId));
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      // Check if this is an alpha project
      if (!project.alpha_view) {
        return { success: false, error: 'Avatar generation is only available for alpha projects' };
      }

      // Get the app directory (where templates folder is located)
      const appDir = app.isPackaged 
        ? require('path').dirname(app.getPath('exe'))
        : process.cwd();
      
      const templatesDir = require('path').join(appDir, 'templates');
      
      await generateAvatarImage(project.path, templatesDir, services);
      return { success: true };
    } catch (error) {
      console.error('[Main] Failed to generate avatar:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to generate avatar' };
    }
  });

  ipcMain.handle('projects:get-avatar', async (_event, projectId: string) => {
    try {
      const project = databaseService.getProject(parseInt(projectId));
      if (!project) {
        return { success: false, error: 'Project not found' };
      }

      const avatarPath = require('path').join(project.path, 'pfp.png');
      if (require('fs').existsSync(avatarPath)) {
        const avatarData = require('fs').readFileSync(avatarPath);
        return { success: true, data: avatarData.toString('base64') };
      } else {
        return { success: false, error: 'Avatar not found' };
      }
    } catch (error) {
      console.error('[Main] Failed to get avatar:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get avatar' };
    }
  });
}

// Helper function to generate avatar image for alpha projects
async function generateAvatarImage(projectPath: string, templatesDir: string, services: AppServices) {
  try {
    const { readFileSync, writeFileSync } = require('fs');
    const path = require('path');
    const OpenAI = require('openai').default;
    
    // Get OpenAI API key from config
    const openaiApiKey = services.configManager.getOpenAIApiKey();
    if (!openaiApiKey) {
      console.log('[Main] No OpenAI API key configured, skipping avatar generation');
      return;
    }
    
    // Read the avatar prompt from the project's local copy (allows user customization)
    const avatarPromptPath = path.join(projectPath, 'avatar-prompt.md');
    let avatarPrompt: string;
    try {
      avatarPrompt = readFileSync(avatarPromptPath, 'utf-8').trim();
      console.log('[Main] Using project-specific avatar prompt from:', avatarPromptPath);
    } catch (error) {
      // Fallback to templates directory if project copy doesn't exist
      const fallbackPath = path.join(templatesDir, 'avatar-prompt.md');
      try {
        avatarPrompt = readFileSync(fallbackPath, 'utf-8').trim();
        console.log('[Main] Using fallback avatar prompt from templates:', fallbackPath);
      } catch (fallbackError) {
        console.log('[Main] avatar-prompt.md not found in project or templates, skipping avatar generation');
        return;
      }
    }
    
    console.log('[Main] Generating avatar image with prompt:', avatarPrompt);
    
    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: openaiApiKey,
    });
    
    // Send initial loading notification
    const projectName = path.basename(projectPath);
    const mainWindow = services.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('avatar-generation-progress', {
        projectName,
        status: 'generating',
        progress: 0,
        message: 'Starting avatar generation...'
      });
    }
    
    // Generate image using responses API with DALL-E 3 for cost efficiency
    const response = await openai.images.generate({
      prompt: avatarPrompt,
      model: "dall-e-2",
      n: 1,
      size: "512x512",
      response_format: "b64_json"
    });
    
    // Send progress update
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('avatar-generation-progress', {
        projectName,
        status: 'generating',
        progress: 50,
        message: 'Processing generated image...'
      });
    }
    
    const imageData = response.data[0];
    if (!imageData.b64_json) {
      throw new Error('No image data received from OpenAI');
    }
    
    const finalImageBuffer = Buffer.from(imageData.b64_json, 'base64');
    console.log('[Main] Image generated successfully');
    
    // Check if there's an existing pfp.png to backup
    const imagePath = path.join(projectPath, 'pfp.png');
    const { existsSync: fsExistsSync, mkdirSync, copyFileSync } = require('fs');
    if (fsExistsSync(imagePath)) {
      // Create pfp backup folder if it doesn't exist
      const backupDir = path.join(projectPath, 'pfp');
      if (!fsExistsSync(backupDir)) {
        mkdirSync(backupDir, { recursive: true });
        console.log('[Main] Created pfp backup directory:', backupDir);
      }
      
      // Generate backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: YYYY-MM-DDTHH-MM-SS
      const backupPath = path.join(backupDir, `pfp-${timestamp}.png`);
      
      // Move existing pfp.png to backup
      copyFileSync(imagePath, backupPath);
      console.log('[Main] Backed up existing avatar to:', backupPath);
    }
    
    // Save new image as pfp.png in the project directory
    writeFileSync(imagePath, finalImageBuffer);
    console.log('[Main] Avatar image saved to:', imagePath);
    
    // Send completion notification
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('avatar-generation-progress', {
        projectName,
        status: 'complete',
        progress: 100,
        message: 'Avatar generated successfully!'
      });
    }
    
  } catch (error) {
    console.error('[Main] Failed to generate avatar image:', error);
    
    // Send error notification
    const projectName = require('path').basename(projectPath);
    const mainWindow = services.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('avatar-generation-progress', {
        projectName,
        status: 'error',
        progress: 0,
        message: `Failed to generate avatar: ${(error as Error).message}`
      });
    }
    
    // Don't fail project creation if image generation fails
  }
} 