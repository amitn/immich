/// Where a link of the assistant's reply leads in the app: a photo, an album or a photo book of the web app's paths
sealed class AssistantLinkTarget {
  const AssistantLinkTarget();
}

final class AssistantPhotoLink extends AssistantLinkTarget {
  final String assetId;

  const AssistantPhotoLink(this.assetId);

  @override
  bool operator ==(Object other) => other is AssistantPhotoLink && other.assetId == assetId;

  @override
  int get hashCode => assetId.hashCode;
}

final class AssistantAlbumLink extends AssistantLinkTarget {
  final String albumId;

  const AssistantAlbumLink(this.albumId);

  @override
  bool operator ==(Object other) => other is AssistantAlbumLink && other.albumId == albumId;

  @override
  int get hashCode => albumId.hashCode;
}

final class AssistantBookLink extends AssistantLinkTarget {
  final String bookId;

  const AssistantBookLink(this.bookId);

  @override
  bool operator ==(Object other) => other is AssistantBookLink && other.bookId == bookId;

  @override
  int get hashCode => bookId.hashCode;
}

/// A link that leaves the app (a web page, an email address)
final class AssistantExternalLink extends AssistantLinkTarget {
  final Uri uri;

  const AssistantExternalLink(this.uri);

  @override
  bool operator ==(Object other) => other is AssistantExternalLink && other.uri == uri;

  @override
  int get hashCode => uri.hashCode;
}

const _uuid = r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
final _photoPath = RegExp('/photos/($_uuid)/?\$');
final _albumPath = RegExp('^/albums/($_uuid)/?\$');
final _bookPath = RegExp('^/books/($_uuid)/?\$');

/// The target of [href]: the app's own screen for a path of the web app (relative, or on the server's domain), the
/// browser for other http(s) and mail links, and null for anything else
AssistantLinkTarget? assistantLinkTarget(String href, {Set<String> serverHosts = const {}}) {
  final uri = Uri.tryParse(href.trim());
  if (uri == null) {
    return null;
  }

  final isServerPath =
      !uri.hasScheme || ((uri.scheme == 'http' || uri.scheme == 'https') && serverHosts.contains(uri.host));
  if (isServerPath && uri.path.startsWith('/')) {
    final photo = _photoPath.firstMatch(uri.path);
    if (photo != null) {
      return AssistantPhotoLink(photo.group(1)!.toLowerCase());
    }
    final album = _albumPath.firstMatch(uri.path);
    if (album != null) {
      return AssistantAlbumLink(album.group(1)!.toLowerCase());
    }
    final book = _bookPath.firstMatch(uri.path);
    if (book != null) {
      return AssistantBookLink(book.group(1)!.toLowerCase());
    }
  }

  if (uri.scheme == 'http' || uri.scheme == 'https' || uri.scheme == 'mailto') {
    return AssistantExternalLink(uri);
  }
  return null;
}
