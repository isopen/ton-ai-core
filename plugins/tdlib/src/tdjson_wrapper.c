#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dlfcn.h>
#include <unistd.h>
#include <sys/select.h>

typedef void *(*td_json_client_create_t)(void);
typedef void (*td_json_client_send_t)(void *, const char *);
typedef char *(*td_json_client_receive_t)(void *, double);
typedef void (*td_json_client_destroy_t)(void *);

int main() {
  const char *libPath = getenv("TDLIB_LIBRARY_PATH");
  if (!libPath) {
    libPath = "/usr/local/lib/libtdjson.so";
  }

  void *handle = dlopen(libPath, RTLD_LAZY);
  if (!handle) {
    fprintf(stderr, "Cannot load library %s: %s\n", libPath, dlerror());
    return 1;
  }

  td_json_client_create_t td_json_client_create = dlsym(handle, "td_json_client_create");
  td_json_client_send_t td_json_client_send = dlsym(handle, "td_json_client_send");
  td_json_client_receive_t td_json_client_receive = dlsym(handle, "td_json_client_receive");
  td_json_client_destroy_t td_json_client_destroy = dlsym(handle, "td_json_client_destroy");

  if (!td_json_client_create || !td_json_client_send || !td_json_client_receive || !td_json_client_destroy) {
    fprintf(stderr, "Failed to load TDLib functions\n");
    dlclose(handle);
    return 1;
  }

  void *client = td_json_client_create();
  if (!client) {
    fprintf(stderr, "Failed to create TDLib client\n");
    dlclose(handle);
    return 1;
  }

  fprintf(stderr, "TDLib client created\n");
  fflush(stderr);

  fd_set readfds;
  struct timeval tv;
  char buffer[65536];

  while (1) {
    FD_ZERO(&readfds);
    FD_SET(STDIN_FILENO, &readfds);
    tv.tv_sec = 0;
    tv.tv_usec = 10000;

    int ret = select(STDIN_FILENO + 1, &readfds, NULL, NULL, &tv);

    if (ret > 0 && FD_ISSET(STDIN_FILENO, &readfds)) {
      if (fgets(buffer, sizeof(buffer), stdin)) {
        size_t len = strlen(buffer);
        if (len > 0 && buffer[len - 1] == '\n') {
          buffer[len - 1] = '\0';
        }
        if (strlen(buffer) > 0) {
          td_json_client_send(client, buffer);
        }
      }
      else {
        break;
      }
    }

    const char *response;
    while ((response = td_json_client_receive(client, 0)) != NULL) {
      printf("%s\n", response);
      fflush(stdout);
    }
  }

  td_json_client_destroy(client);
  dlclose(handle);
  return 0;
}
