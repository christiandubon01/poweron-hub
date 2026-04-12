/**
 * SPARK Training Services
 * 
 * Exports for role-play engine and objection management
 */

export {
  generateCharacterPrompt,
  customCharacterFromDescription,
  customCharacterFromHunterLead,
  conductRound,
  CHARACTER_TEMPLATES,
  type CharacterTemplate,
  type GeneratedCharacter,
  type ConversationRound,
  type HunterLead,
} from './SparkRolePlayEngine';

export {
  SparkObjectionEngine,
  getObjectionEngine,
  type Objection,
  type ObjectionSet,
  type ObjectionCategory,
} from './SparkObjectionEngine';
