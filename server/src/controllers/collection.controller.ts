import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  CollectionEntriesDto,
  CollectionEntriesResponseDto,
  CollectionMatchDto,
  CollectionMatchResponseDto,
  CollectionPackParamDto,
  CollectionPackResponseDto,
  CollectionSummaryResponseDto,
  CollectionVisitsDto,
  CollectionVisitsResponseDto,
} from 'src/dtos/collection.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { CollectionService } from 'src/services/collection.service.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Collections)
@Controller('collections')
export class CollectionController {
  constructor(private service: CollectionService) {}

  @Get()
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'List collection packs',
    description:
      'Retrieve the collection packs (food is the first): the theme of each, the words of its domain, the root of its tags and its book style.',
    history: history(),
  })
  getCollectionPacks(): CollectionPackResponseDto[] {
    return this.service.getPacks();
  }

  @Get('summary')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Summarize the collections',
    description:
      "Retrieve what the collections of the user hold, per pack: the photos, visits, places and entries named with the tags of the pack, the years covered and the places visited most recently. Only the user's own photos are counted, and the names of packs that hide private text are redacted.",
    history: history(),
  })
  getCollectionSummary(@Auth() auth: AuthDto): Promise<CollectionSummaryResponseDto> {
    return this.service.getSummary(auth);
  }

  @Post(':pack/visits')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Find the visits of a collection',
    description:
      'Find the visits of a collection pack (e.g. the restaurant meals of food) among the photos of an album, a list of assets or a date range: photos of subjects, sources, signs and receipts are recognized with CLIP and the text read on them, and grouped into visits by time and place. Each visit comes with the best name for its place (from the tags of the pack, read on a sign, source or receipt, or made up from the visit and the city) and the tags of the pack already on its photos.',
    history: history(),
  })
  findCollectionVisits(
    @Auth() auth: AuthDto,
    @Param() { pack }: CollectionPackParamDto,
    @Body() dto: CollectionVisitsDto,
  ): Promise<CollectionVisitsResponseDto> {
    return this.service.findVisits(auth, pack, dto);
  }

  @Post(':pack/match')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Match the subjects of a visit',
    description:
      'Suggest which entry each subject photo of a visit shows, from the entries read on its source photos (at full resolution) or the entries given. Photos of the same subject are grouped; weak matches are marked unsure, and subjects that are probably not on the source get no match.',
    history: history(),
  })
  matchCollectionVisit(
    @Auth() auth: AuthDto,
    @Param() { pack }: CollectionPackParamDto,
    @Body() dto: CollectionMatchDto,
  ): Promise<CollectionMatchResponseDto> {
    return this.service.matchVisit(auth, pack, dto);
  }

  @Put(':pack/entries')
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Name the entries of a visit',
    description:
      'Tag each photo with <Root>/<Place>/<Entry>, or <Root>/<Place>/<SourceLeaf> for a photo of the source (e.g. Food/<Restaurant>/Menu), replacing the tag of the pack it had, and describe subject photos without a description in the words of the pack (e.g. "<Dish> · <Restaurant>").',
    history: history(),
  })
  saveCollectionEntries(
    @Auth() auth: AuthDto,
    @Param() { pack }: CollectionPackParamDto,
    @Body() dto: CollectionEntriesDto,
  ): Promise<CollectionEntriesResponseDto> {
    return this.service.saveEntries(auth, pack, dto);
  }
}
