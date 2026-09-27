import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { BookUserStyleCreateDto, BookUserStyleResponseDto, BookUserStyleUpdateDto } from 'src/dtos/book.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { BookStyleService } from 'src/services/book-style.service.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.3.0').alpha('v3.3.0');

@ApiTags(ApiTag.Books)
@Controller('book-styles')
export class BookStyleController {
  constructor(private service: BookStyleService) {}

  @Get()
  @Authenticated({ permission: Permission.BookStyleRead })
  @Endpoint({
    summary: 'List your book styles',
    description:
      'Retrieve the book styles of the current user, e.g. designed with the assistant. They are listed next to the ' +
      'built-in presets (GET /books/style-presets) and applied to a book with its styleId.',
    history: history(),
  })
  getBookUserStyles(@Auth() auth: AuthDto): Promise<BookUserStyleResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Post()
  @Authenticated({ permission: Permission.BookStyleCreate })
  @Endpoint({
    summary: 'Create a book style',
    description:
      'Save a book style of your own. It is checked strictly: fonts from the stacks that render, opaque colours, ' +
      'readable text on the background, and margins and sizes that print well.',
    history: history(),
  })
  createBookUserStyle(@Auth() auth: AuthDto, @Body() dto: BookUserStyleCreateDto): Promise<BookUserStyleResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get(':id')
  @Authenticated({ permission: Permission.BookStyleRead })
  @Endpoint({ summary: 'Retrieve a book style', description: 'Retrieve one of your book styles.', history: history() })
  getBookUserStyle(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<BookUserStyleResponseDto> {
    return this.service.get(auth, id);
  }

  @Put(':id')
  @Authenticated({ permission: Permission.BookStyleUpdate })
  @Endpoint({
    summary: 'Update a book style',
    description: 'Rename one of your book styles, or change it. Books that use it keep their copy of the style.',
    history: history(),
  })
  updateBookUserStyle(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: BookUserStyleUpdateDto,
  ): Promise<BookUserStyleResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.BookStyleDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a book style',
    description: 'Delete one of your book styles. Books that use it keep their copy of the style.',
    history: history(),
  })
  deleteBookUserStyle(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }
}
