import { Body, Controller, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  FoodDishesDto,
  FoodDishesResponseDto,
  FoodMatchDto,
  FoodMatchResponseDto,
  FoodMealsDto,
  FoodMealsResponseDto,
} from 'src/dtos/food.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { FoodService } from 'src/services/food.service.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Food)
@Controller('food')
export class FoodController {
  constructor(private service: FoodService) {}

  @Post('meals')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Find meals',
    description:
      'Find the restaurant meals among the photos of an album, a list of assets or a date range: photos of dishes and drinks, menus, restaurant signs and receipts are recognized with CLIP and the text read on them, and grouped into visits by time and place. Each meal comes with the best name for its restaurant (from its food tags, or read on a sign, menu or receipt, or made up from the meal and the city) and the food tags already on its photos.',
    history: history(),
  })
  findMeals(@Auth() auth: AuthDto, @Body() dto: FoodMealsDto): Promise<FoodMealsResponseDto> {
    return this.service.findMeals(auth, dto);
  }

  @Post('meals/match')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Match the dishes of a meal',
    description:
      'Suggest which menu item each dish photo of a meal shows, from the items read on its menu photos (at full resolution) or the items given. Photos of the same dish are grouped; weak matches are marked unsure, and dishes that are probably not on the menu get no match.',
    history: history(),
  })
  matchMeal(@Auth() auth: AuthDto, @Body() dto: FoodMatchDto): Promise<FoodMatchResponseDto> {
    return this.service.matchMeal(auth, dto);
  }

  @Put('dishes')
  @Authenticated({ permission: Permission.AssetUpdate })
  @Endpoint({
    summary: 'Name dishes',
    description:
      'Tag each photo with Food/<Restaurant>/<Dish>, or Food/<Restaurant>/Menu for a photo of the menu, replacing the food tag it had, and describe dish photos without a description as "<Dish> · <Restaurant>".',
    history: history(),
  })
  setDishNames(@Auth() auth: AuthDto, @Body() dto: FoodDishesDto): Promise<FoodDishesResponseDto> {
    return this.service.setDishNames(auth, dto);
  }
}
