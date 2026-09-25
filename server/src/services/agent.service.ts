import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';

/** Runs assistant chat sessions against an ACP agent */
@Injectable()
export class AgentService extends BaseService {}
