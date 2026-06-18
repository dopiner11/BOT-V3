// utils/pointsManager.js
import Member from '../models/Member.js';
import { assessMemberStatus } from './interactionMonitor.js';

let _guild = null;
let _client = null;

export function setPointsManagerContext(client, guild) {
  _client = client;
  _guild = guild;
}

export default {
  // تحديث نقاط المستخدم وتسجيل النشاط
  updateUserPoints: async function(userId, pointsToAdd, reason = '') {
    try {
      console.log(`📊 [نقاط] ${userId}: +${pointsToAdd} (${reason})`);
      
      const member = await Member.findOne({ discordId: userId });
      if (member) {
        member.points += pointsToAdd;
        await member.save();
        
        // تحديث حالة التفاعل
        if (_client && _guild) {
          await assessMemberStatus(_client, _guild, userId);
        }
        
        return { 
          userId, 
          points: pointsToAdd, 
          totalPoints: member.points,
          success: true 
        };
      }
      
      return { userId, points: 0, totalPoints: 0, success: false };
    } catch (error) {
      console.error('❌ خطأ في تحديث النقاط:', error);
      return { userId, points: 0, totalPoints: 0, success: false };
    }
  },

  // جلب نقاط المستخدم
  getUserPoints: async function(userId) {
    try {
      const member = await Member.findOne({ discordId: userId });
      return member ? member.points : 0;
    } catch (error) {
      console.error('❌ خطأ في جلب النقاط:', error);
      return 0;
    }
  },

  // جلب أعلى النقاط
  getTopUsers: async function(limit = 10) {
    try {
      const members = await Member.find({ isActive: true }, { points: -1 }, limit);
      
      return members.map(member => ({
        discordId: member.discordId,
        gameName: member.gameName,
        points: member.points,
        rank: member.currentRank
      }));
    } catch (error) {
      console.error('❌ خطأ في جلب أفضل الأعضاء:', error);
      return [];
    }
  },

  // جلب معلومات المستخدم الكاملة
  getUserData: async function(userId) {
    try {
      const member = await Member.findOne({ discordId: userId });
      if (!member) {
        return null;
      }
      
      return {
        userId: member.discordId,
        gameId: member.gameId,
        gameName: member.gameName,
        points: member.points,
        warnings: member.warnings || 0,
        jobNumber: member.jobNumber,
        currentRank: member.currentRank,
        joinDate: member.joinDate,
        lastActivity: member.updatedAt,
        isActive: member.isActive
      };
    } catch (error) {
      console.error('❌ خطأ في جلب بيانات المستخدم:', error);
      return null;
    }
  },

  // تحديث تحذيرات المستخدم
  updateUserWarnings: async function(userId, warningsToAdd, reason = '') {
    try {
      console.log(`⚠️ [تحذيرات] ${userId}: +${warningsToAdd} (${reason})`);
      
      const member = await Member.findOne({ discordId: userId });
      if (member) {
        member.warnings = (member.warnings || 0) + warningsToAdd;
        await member.save();
        
        return { 
          userId, 
          warnings: warningsToAdd, 
          totalWarnings: member.warnings,
          success: true 
        };
      }
      
      return { userId, warnings: 0, success: false };
    } catch (error) {
      console.error('❌ خطأ في تحديث التحذيرات:', error);
      return { userId, warnings: 0, success: false };
    }
  },

  // إزالة جميع تحذيرات المستخدم
  resetUserWarnings: async function(userId) {
    try {
      console.log(`✅ [إزالة تحذيرات] ${userId}`);
      
      const member = await Member.findOne({ discordId: userId });
      if (member) {
        const oldWarnings = member.warnings || 0;
        member.warnings = 0;
        await member.save();
        
        return { 
          userId, 
          oldWarnings, 
          newWarnings: 0, 
          success: true 
        };
      }
      
      return { userId, oldWarnings: 0, newWarnings: 0, success: false };
    } catch (error) {
      console.error('❌ خطأ في إزالة التحذيرات:', error);
      return { userId, oldWarnings: 0, newWarnings: 0, success: false };
    }
  },

  // إغلاق الاتصال
  closeConnection: async function() {
    console.log('🔌 [إغلاق اتصال] pointsManager');
    return true;
  }
};