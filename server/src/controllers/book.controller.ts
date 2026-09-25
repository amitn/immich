import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Next,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { NextFunction, Response } from 'express';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  BookCreateDto,
  BookDetailResponseDto,
  BookLayoutResponseDto,
  BookPageCreateDto,
  BookPageMoveDto,
  BookPageParamDto,
  BookPageResponseDto,
  BookPageUpdateDto,
  BookRenderQueryDto,
  BookResponseDto,
  BookSlotParamDto,
  BookSlotPatchDto,
  BookSlotUpdateDto,
  BookUpdateDto,
} from 'src/dtos/book.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { BookService } from 'src/services/book.service.js';
import { sendFile } from 'src/utils/file.js';
import { UUIDParamDto } from 'src/validation.js';

const history = () => new HistoryBuilder().added('v3.0.0').alpha('v3.0.0');

@ApiTags(ApiTag.Books)
@Controller('books')
export class BookController {
  constructor(
    private service: BookService,
    private logger: LoggingRepository,
  ) {}

  @Get()
  @Authenticated({ permission: Permission.BookRead })
  @Endpoint({ summary: 'List books', description: 'Retrieve the photo books of the current user.', history: history() })
  getBooks(@Auth() auth: AuthDto): Promise<BookResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Post()
  @Authenticated({ permission: Permission.BookCreate })
  @Endpoint({ summary: 'Create a book', description: 'Create an empty photo book.', history: history() })
  createBook(@Auth() auth: AuthDto, @Body() dto: BookCreateDto): Promise<BookDetailResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get('layouts')
  @Authenticated({ permission: Permission.BookRead })
  @Endpoint({
    summary: 'List book layouts',
    description: 'Retrieve the page layouts that can be used in photo books.',
    history: history(),
  })
  getBookLayouts(): BookLayoutResponseDto[] {
    return this.service.getLayouts();
  }

  @Get(':id')
  @Authenticated({ permission: Permission.BookRead })
  @Endpoint({
    summary: 'Retrieve a book',
    description: 'Retrieve a photo book with its pages and placed photos.',
    history: history(),
  })
  getBook(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<BookDetailResponseDto> {
    return this.service.get(auth, id);
  }

  @Patch(':id')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({
    summary: 'Update a book',
    description: 'Update the title, subtitle, cover, page size or style of a photo book.',
    history: history(),
  })
  updateBook(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: BookUpdateDto,
  ): Promise<BookDetailResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Delete(':id')
  @Authenticated({ permission: Permission.BookDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a book',
    description: 'Delete a photo book and its exported PDF. The photos are not affected.',
    history: history(),
  })
  deleteBook(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }

  @Post(':id/pages')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({ summary: 'Add a book page', description: 'Insert a page with the given layout.', history: history() })
  addBookPage(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: BookPageCreateDto,
  ): Promise<BookPageResponseDto> {
    return this.service.addPage(auth, id, dto);
  }

  @Patch(':id/pages/:pageId')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({
    summary: 'Update a book page',
    description: 'Update the layout, section title, caption or background of a page.',
    history: history(),
  })
  updateBookPage(
    @Auth() auth: AuthDto,
    @Param() { id, pageId }: BookPageParamDto,
    @Body() dto: BookPageUpdateDto,
  ): Promise<BookPageResponseDto> {
    return this.service.updatePage(auth, id, pageId, dto);
  }

  @Delete(':id/pages/:pageId')
  @Authenticated({ permission: Permission.BookUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({ summary: 'Remove a book page', description: 'Remove a page from a photo book.', history: history() })
  removeBookPage(@Auth() auth: AuthDto, @Param() { id, pageId }: BookPageParamDto): Promise<void> {
    return this.service.removePage(auth, id, pageId);
  }

  @Put(':id/pages/:pageId/position')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({ summary: 'Move a book page', description: 'Move a page to a new position.', history: history() })
  moveBookPage(
    @Auth() auth: AuthDto,
    @Param() { id, pageId }: BookPageParamDto,
    @Body() dto: BookPageMoveDto,
  ): Promise<BookPageResponseDto> {
    return this.service.movePage(auth, id, pageId, dto);
  }

  @Put(':id/pages/:pageId/slots/:slot')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({
    summary: 'Place a photo in a book page slot',
    description: 'Place an asset in a slot of a page. Without a crop, a crop matching the slot is chosen.',
    history: history(),
  })
  setBookSlot(
    @Auth() auth: AuthDto,
    @Param() { id, pageId, slot }: BookSlotParamDto,
    @Body() dto: BookSlotUpdateDto,
  ): Promise<BookPageResponseDto> {
    return this.service.setSlot(auth, id, pageId, slot, dto);
  }

  @Patch(':id/pages/:pageId/slots/:slot')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({
    summary: 'Update a book page slot',
    description: 'Change the crop or caption of a placed photo. A null crop resets it to the default crop.',
    history: history(),
  })
  updateBookSlot(
    @Auth() auth: AuthDto,
    @Param() { id, pageId, slot }: BookSlotParamDto,
    @Body() dto: BookSlotPatchDto,
  ): Promise<BookPageResponseDto> {
    return this.service.updateSlot(auth, id, pageId, slot, dto);
  }

  @Delete(':id/pages/:pageId/slots/:slot')
  @Authenticated({ permission: Permission.BookUpdate })
  @Endpoint({ summary: 'Clear a book page slot', description: 'Remove the photo from a slot.', history: history() })
  clearBookSlot(@Auth() auth: AuthDto, @Param() { id, pageId, slot }: BookSlotParamDto): Promise<BookPageResponseDto> {
    return this.service.clearSlot(auth, id, pageId, slot);
  }

  @Get(':id/pages/:pageId/render')
  @Authenticated({ permission: Permission.BookRead })
  @FileResponse()
  @Endpoint({
    summary: 'Render a book page',
    description: 'Render a page of a photo book as a JPEG image, using the preview files of the placed assets.',
    history: history(),
  })
  async renderBookPage(
    @Auth() auth: AuthDto,
    @Param() { id, pageId }: BookPageParamDto,
    @Query() dto: BookRenderQueryDto,
  ): Promise<StreamableFile> {
    const { data } = await this.service.renderPage(auth, id, pageId, dto);
    return new StreamableFile(data, { type: 'image/jpeg', length: data.length });
  }

  @Post(':id/export')
  @Authenticated({ permission: Permission.BookDownload })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Export a book as PDF',
    description:
      'Queue the print-ready (300 dpi) PDF export of a photo book. Poll the book until exportStatus is completed.',
    history: history(),
  })
  async exportBook(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    await this.service.export(auth, id);
  }

  @Get(':id/pdf')
  @Authenticated({ permission: Permission.BookDownload })
  @FileResponse()
  @Endpoint({ summary: 'Download a book PDF', description: 'Download the exported PDF of a book.', history: history() })
  async downloadBookPdf(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    await sendFile(res, next, () => this.service.downloadPdf(auth, id), this.logger);
  }
}
