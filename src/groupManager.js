const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');
const { safeWriteJson } = require('./utils/safeWrite');

class GroupManager {
  constructor(lightManager) {
    this.lightManager = lightManager;
    this.groups = new Map();
    this.configPath = path.join(__dirname, '..', 'config', 'groups.json');
  }

  async loadConfig() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(data);
      
      this.groups.clear();
      
      for (const group of config.groups || []) {
        this.groups.set(group.id, {
          id: group.id,
          name: group.name,
          lights: group.lights || [],
          groups: group.groups || [],
          description: group.description || ''
        });
      }
      
      logger.info(`Loaded ${this.groups.size} groups from config`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No groups config found, creating default');
        await this.saveConfig();
      } else {
        logger.error('Error loading groups config:', error);
        throw error;
      }
    }
  }

  async saveConfig() {
    try {
      const config = {
        groups: Array.from(this.groups.values())
      };
      
      await safeWriteJson(this.configPath, config);
      logger.verbose('Groups config saved');
    } catch (error) {
      logger.error('Error saving groups config:', error);
      throw error;
    }
  }

  async updateGroupOrder(groupIds) {
    // Reorder groups map based on provided order
    const orderedGroups = new Map();
    
    for (const id of groupIds) {
      const group = this.groups.get(id);
      if (group) {
        orderedGroups.set(id, group);
      }
    }
    
    // Add any groups not in the order list (shouldn't happen, but safety)
    for (const [id, group] of this.groups.entries()) {
      if (!orderedGroups.has(id)) {
        orderedGroups.set(id, group);
      }
    }
    
    this.groups = orderedGroups;
    await this.saveConfig();
    logger.verbose('Group order updated');
  }

  getAllGroups() {
    return Array.from(this.groups.values()).map(group => ({
      ...group,
      lightCount: group.lights.length,
      totalLightCount: this.getAllLightsInGroup(group.id).length
    }));
  }

  getGroup(groupId) {
    const group = this.groups.get(groupId);
    if (group) {
      return {
        ...group,
        totalLightCount: this.getAllLightsInGroup(groupId).length
      };
    }
    return null;
  }

  async createGroup(name, description = '', lights = [], groups = []) {
    const id = name.toLowerCase().replace(/\s+/g, '-');
    
    if (this.groups.has(id)) {
      throw new Error('Group already exists');
    }
    
    const group = {
      id,
      name,
      description,
      lights,
      groups
    };
    
    this.groups.set(id, group);
    await this.saveConfig();
    
    logger.info(`Group created: ${name} (${id})`);
    return group;
  }

  async updateGroup(groupId, updates) {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }
    
    if (updates.name !== undefined) {
      group.name = updates.name;
    }
    
    if (updates.description !== undefined) {
      group.description = updates.description;
    }
    
    if (updates.lights !== undefined) {
      if (!Array.isArray(updates.lights)) {
        throw new Error('Lights must be an array');
      }
      group.lights = updates.lights;
    }
    
    if (updates.groups !== undefined) {
      if (!Array.isArray(updates.groups)) {
        throw new Error('Groups must be an array');
      }
      // Check for circular references
      if (this.hasCircularReference(groupId, updates.groups)) {
        throw new Error('Circular group reference detected');
      }
      group.groups = updates.groups;
    }
    
    this.groups.set(groupId, group);
    await this.saveConfig();
    
    logger.info(`Group updated: ${groupId}`);
    return group;
  }

  async deleteGroup(groupId) {
    if (!this.groups.has(groupId)) {
      throw new Error('Group not found');
    }
    
    this.groups.delete(groupId);
    await this.saveConfig();
    
    logger.info(`Group deleted: ${groupId}`);
    return true;
  }

  async addLightToGroup(groupId, lightId) {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }
    
    if (!group.lights.includes(lightId)) {
      group.lights.push(lightId);
      await this.saveConfig();
      logger.verbose(`Light ${lightId} added to group ${groupId}`);
    }
    
    return group;
  }

  async removeLightFromGroup(groupId, lightId) {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }
    
    group.lights = group.lights.filter(id => id !== lightId);
    await this.saveConfig();
    
    logger.verbose(`Light ${lightId} removed from group ${groupId}`);
    return group;
  }

  // Check for circular group references
  hasCircularReference(groupId, nestedGroups, visited = new Set()) {
    if (visited.has(groupId)) {
      return true; // Circular reference detected
    }
    
    visited.add(groupId);
    
    for (const nestedGroupId of nestedGroups) {
      if (nestedGroupId === groupId) {
        return true; // Direct self-reference
      }
      
      const nestedGroup = this.groups.get(nestedGroupId);
      if (nestedGroup && nestedGroup.groups) {
        if (this.hasCircularReference(groupId, nestedGroup.groups, new Set(visited))) {
          return true;
        }
      }
    }
    
    return false;
  }

  // Get all groups a light belongs to (including inherited from nested groups)
  getLightGroups(lightId) {
    const allGroups = new Set();
    
    // Find direct groups (groups that directly contain this light)
    for (const [groupId, group] of this.groups.entries()) {
      if (group.lights && group.lights.includes(lightId)) {
        allGroups.add(groupId);
      }
    }
    
    // Find inherited groups (groups that contain the direct groups)
    const directGroups = new Set(allGroups);
    for (const directGroupId of directGroups) {
      this.findParentGroups(directGroupId, allGroups);
    }
    
    // Return unique array of group IDs
    return Array.from(allGroups);
  }
  
  // Helper to recursively find parent groups
  findParentGroups(groupId, result, visited = new Set()) {
    if (visited.has(groupId)) return;
    visited.add(groupId);
    
    for (const [parentGroupId, parentGroup] of this.groups.entries()) {
      if (parentGroup.groups && parentGroup.groups.includes(groupId)) {
        result.add(parentGroupId);
        this.findParentGroups(parentGroupId, result, visited);
      }
    }
  }

  // Update which groups a light belongs to
  async updateLightGroups(lightId, newGroups) {
    // Remove light from all groups first
    for (const group of this.groups.values()) {
      if (group.lights) {
        group.lights = group.lights.filter(id => id !== lightId);
      }
    }
    
    // Add light to new groups
    for (const groupId of newGroups) {
      const group = this.groups.get(groupId);
      if (group) {
        if (!group.lights) {
          group.lights = [];
        }
        if (!group.lights.includes(lightId)) {
          group.lights.push(lightId);
        }
      }
    }
    
    await this.saveConfig();
    logger.info(`Updated groups for light ${lightId}: ${newGroups.join(', ')}`);
  }

  // Get all lights in a group (including from nested groups)
  getAllLightsInGroup(groupId, visited = new Set()) {
    if (visited.has(groupId)) {
      return []; // Prevent infinite loops
    }
    
    visited.add(groupId);
    
    const group = this.groups.get(groupId);
    if (!group) {
      return [];
    }
    
    let allLights = [...(group.lights || [])];
    
    // Recursively get lights from nested groups
    if (group.groups && group.groups.length > 0) {
      for (const nestedGroupId of group.groups) {
        const nestedLights = this.getAllLightsInGroup(nestedGroupId, visited);
        allLights = allLights.concat(nestedLights);
      }
    }
    
    // Remove duplicates
    return [...new Set(allLights)];
  }

  async controlGroup(groupId, params, source = 'manual') {
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }
    
    // Get all lights including from nested groups
    const allLights = this.getAllLightsInGroup(groupId);
    
    const results = [];
    const errors = [];
    
    for (const lightId of allLights) {
      try {
        const light = this.lightManager.getLight(lightId);
        if (!light) {
          errors.push({ lightId, error: 'Light not found' });
          continue;
        }
        
        // Apply control
        await this.lightManager.controlLight(lightId, params, `group:${groupId}`);
        results.push({ lightId, success: true });
      } catch (error) {
        errors.push({ lightId, error: error.message });
      }
    }
    
    return {
      groupId,
      totalLights: allLights.length,
      successful: results.filter(r => r.success).length,
      skipped: results.filter(r => r.skipped).length,
      failed: errors.length,
      results,
      errors
    };
  }

  getGroupsForLight(lightId) {
    return Array.from(this.groups.values())
      .filter(group => group.lights.includes(lightId))
      .map(group => ({ id: group.id, name: group.name }));
  }
}

module.exports = GroupManager;
