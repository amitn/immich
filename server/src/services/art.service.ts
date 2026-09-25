import { Injectable } from '@nestjs/common';
import { BaseService } from 'src/services/base.service.js';

/** Runs artistic style transforms through the configured ACP art agent */
@Injectable()
export class ArtService extends BaseService {}
